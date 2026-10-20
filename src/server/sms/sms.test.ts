import test from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from '../db/connection.ts';
import { insertNewParcels } from '../db/parcels.ts';
import { createTestDb } from '../db/test-db.ts';
import { cambodiaDate } from '../db/values.ts';
import { GatewayError, writeGatewayConfig, type MessageState, type SmsGate } from '../gateway/smsgate.ts';
import { controlBatch, listContactEvents, notifyToday, queueMessage, recordContact } from './queue.ts';
import { smsWorker } from './worker.ts';

const TODAY = cambodiaDate();
const YESTERDAY = cambodiaDate(new Date(Date.now() - 86_400_000));

async function setup(t: test.TestContext) {
  const { db, dir, cleanup } = await createTestDb();
  t.after(cleanup);
  const importId = Number(
    db
      .prepare(
        `INSERT INTO imports (source, original_filename, stored_path, sha256, size_bytes, status, rules, headers_found, scan_dates,
           rows_total, rows_shopee, rows_excluded, excluded_codes, rows_collapsed, parcels_unique, db_duplicates, left_out, blocked, ready, checked_at)
         VALUES ('manual', 'x.xlsx', '/tmp/x', 'h', 1, 'checked', '[]', '{}', '{}', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)`,
      )
      .run(new Date().toISOString()).lastInsertRowid,
  );
  const { inserted } = insertNewParcels(db, importId, [
    { trackingCode: 'A1', recipientName: 'Dara', phoneRaw: '012 345 678', arrivalDate: TODAY },
    { trackingCode: 'A2', recipientName: 'Dara', phoneRaw: '012 345 678', arrivalDate: TODAY },
    { trackingCode: 'B1', recipientName: 'Sokha', phoneRaw: '097 880 1123', arrivalDate: TODAY },
    { trackingCode: 'Y1', recipientName: 'Dara', phoneRaw: '012 345 678', arrivalDate: YESTERDAY },
  ]);
  const [a1, a2, b1, y1] = inserted;
  writeGatewayConfig(dir, { url: 'http://phone:8080', username: 'sms', password: 'secret' });
  return { db, dir, a1, a2, b1, y1 };
}

/** A gateway phone under the test's control. Every hand-over is counted, so a duplicate would show. */
function fakePhone() {
  const messages = new Map<string, MessageState>();
  const phone = {
    sends: [] as string[],
    sendWith: 'accept' as 'accept' | 'timeout' | 'timeout-lost' | 'unreachable' | 'auth',
    lookupFails: false,
    messages,
    gate: {
      async send(m: { id: string }) {
        phone.sends.push(m.id);
        if (phone.sendWith === 'unreachable') throw new GatewayError('unreachable', 'away');
        if (phone.sendWith === 'auth') throw new GatewayError('auth', 'bad password');
        const duplicate = messages.has(m.id);
        if (phone.sendWith !== 'timeout-lost' && !duplicate) messages.set(m.id, { id: m.id, state: 'Pending', states: {}, error: null });
        if (phone.sendWith !== 'accept') return { outcome: 'unknown' as const, reason: 'timeout' };
        return { outcome: 'accepted' as const, duplicate };
      },
      async lookup(id: string) {
        if (phone.lookupFails) throw new GatewayError('unreachable', 'away');
        return messages.get(id) ?? null;
      },
    } as unknown as SmsGate,
    set(id: string, state: MessageState['state'], error: string | null = null) {
      messages.set(id, { id, state, states: {}, error });
    },
  };
  return phone;
}

const attempts = (db: Db) => db.prepare('SELECT id, notification_id, attempt_no, state, error_code FROM sms_attempts ORDER BY queued_at, attempt_no').all() as {
  id: string;
  notification_id: number;
  attempt_no: number;
  state: string;
  error_code: string | null;
}[];
const silent = () => {};

test('one SMS per phone line: a second one while it waits, another number and two days are refused', async (t) => {
  const { db, a1, a2, b1, y1 } = await setup(t);
  const first = queueMessage(db, { phone: '012 345 678', parcelIds: [a1, a2], text: 'Hi Dara, 2 parcels' }, null);
  assert.equal(first.ok, true);
  assert.equal(queueMessage(db, { phone: '012345678', parcelIds: [a1], text: 'again' }, null).ok, false);
  const wrongLine = queueMessage(db, { phone: '012 345 678', parcelIds: [b1], text: 'x' }, null);
  assert.deepEqual(wrongLine.ok ? null : wrongLine.error, 'phone_changed');
  const twoDays = queueMessage(db, { phone: '012 345 678', parcelIds: [a1, y1], text: 'x' }, null);
  assert.deepEqual(twoDays.ok ? null : twoDays.error, 'mixed_days');
  const events = listContactEvents(db);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].parcelCodes, ['A1', 'A2']);
  assert.equal(events[0].smsStatus, 'queued');
  assert.equal(events[0].phone, '012345678');
});

test("Notify today's customers: today's lines only, re-checked, and the same request twice creates nothing", async (t) => {
  const { db, a1, a2, b1, y1 } = await setup(t);
  recordContact(db, { phone: '097 880 1123', parcelIds: [b1], channel: 'call', outcome: 'answered' }, null);
  const key = crypto.randomUUID();
  const items = [
    { phone: '012 345 678', parcelIds: [a1, a2], text: 'Hi Dara' },
    { phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' }, // reached by call: skipped
    { phone: '012 345 678', parcelIds: [y1], text: 'Hi Dara, yesterday' }, // an earlier batch: never automatic
  ];
  const r = notifyToday(db, key, items, null);
  assert.ok(r.ok);
  assert.deepEqual([r.queued, r.skipped], [1, 2]);
  const again = notifyToday(db, key, items, null);
  assert.ok(again.ok && again.repeated);
  assert.equal(attempts(db).length, 1);
  const none = notifyToday(db, crypto.randomUUID(), items, null);
  assert.deepEqual(none.ok ? null : none.error, 'nothing_to_send'); // Dara is queued now, Sokha reached
});

test('the worker hands messages over one at a time and follows the phone to Delivered', async (t) => {
  const { db, dir, a1, b1 } = await setup(t);
  const phone = fakePhone();
  let clock = Date.now();
  const worker = smsWorker(db, dir, silent, { make: () => phone.gate, now: () => clock });
  queueMessage(db, { phone: '012 345 678', parcelIds: [a1], text: 'Hi Dara' }, null);
  queueMessage(db, { phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' }, null);

  assert.equal(await worker.tick(), true);
  assert.deepEqual(attempts(db).map((a) => a.state), ['submitted', 'queued']);
  await worker.tick();
  assert.deepEqual(attempts(db).map((a) => a.state), ['submitted', 'submitted']);
  const [first] = attempts(db);
  phone.set(first.id, 'Sent');
  clock += 5_000;
  await worker.tick();
  assert.equal(attempts(db)[0].state, 'sent');
  phone.set(first.id, 'Delivered');
  clock += 5_000;
  await worker.tick();
  assert.equal(attempts(db)[0].state, 'delivered');
  assert.equal(phone.sends.length, 2);
  assert.equal(listContactEvents(db).find((e) => e.parcelCodes[0] === 'A1')?.smsStatus, 'delivered');
});

test('after a crash: Sending the phone never got is Not sent, Accepted it has lost is Check phone; nothing is resent', async (t) => {
  const { db, dir, a1, b1 } = await setup(t);
  queueMessage(db, { phone: '012 345 678', parcelIds: [a1], text: 'Hi Dara' }, null);
  queueMessage(db, { phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' }, null);
  const [sending, accepted] = attempts(db);
  db.prepare(`UPDATE sms_attempts SET state = 'submitting' WHERE id = ?`).run(sending.id);
  db.prepare(`UPDATE sms_attempts SET state = 'submitted', submitted_at = ? WHERE id = ?`).run(new Date().toISOString(), accepted.id);

  const phone = fakePhone();
  await smsWorker(db, dir, silent, { make: () => phone.gate }).tick();
  const after = attempts(db);
  assert.deepEqual([after[0].state, after[0].error_code], ['cancelled', 'restart_not_sent']);
  assert.deepEqual([after[1].state, after[1].error_code], ['unconfirmed', 'missing_on_phone']);
  assert.equal(phone.sends.length, 0);
  // Not sent may be sent again by staff; Check phone may not go out with the next bulk run.
  assert.equal(listContactEvents(db).find((e) => e.parcelCodes[0] === 'A1')?.smsStatus, 'not-sent');
  assert.equal(queueMessage(db, { phone: '097 880 1123', parcelIds: [b1], text: 'x' }, null).ok, false);
});

test('after a crash with the phone away, the half-sent message is Check phone', async (t) => {
  const { db, dir, a1 } = await setup(t);
  queueMessage(db, { phone: '012 345 678', parcelIds: [a1], text: 'Hi Dara' }, null);
  db.prepare(`UPDATE sms_attempts SET state = 'submitting'`).run();
  const phone = fakePhone();
  phone.lookupFails = true;
  await smsWorker(db, dir, silent, { make: () => phone.gate }).tick();
  assert.equal(attempts(db)[0].state, 'unconfirmed');
});

test('a hand-over with no answer is looked up by ID; one the phone never got goes again under the same ID', async (t) => {
  const { db, dir, a1, b1 } = await setup(t);
  const phone = fakePhone();
  const worker = smsWorker(db, dir, silent, { make: () => phone.gate });
  queueMessage(db, { phone: '012 345 678', parcelIds: [a1], text: 'Hi Dara' }, null);
  phone.sendWith = 'timeout';
  await worker.tick();
  assert.equal(attempts(db)[0].state, 'submitted'); // the phone had it

  queueMessage(db, { phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' }, null);
  phone.sendWith = 'timeout-lost';
  await worker.tick();
  assert.equal(attempts(db)[1].state, 'queued');
  phone.sendWith = 'accept';
  await worker.tick();
  assert.equal(attempts(db)[1].state, 'submitted');
  assert.deepEqual(phone.sends.slice(1), [attempts(db)[1].id, attempts(db)[1].id]);
  assert.equal(phone.messages.size, 2);
});

test('an unreachable phone keeps the message waiting; a refused password fails it and pauses the batch', async (t) => {
  const { db, dir, a1, a2, b1 } = await setup(t);
  const phone = fakePhone();
  const worker = smsWorker(db, dir, silent, { make: () => phone.gate });
  const r = notifyToday(db, crypto.randomUUID(), [
    { phone: '012 345 678', parcelIds: [a1, a2], text: 'Hi Dara' },
    { phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' },
  ], null);
  assert.ok(r.ok);
  phone.sendWith = 'unreachable';
  await worker.tick();
  assert.deepEqual(attempts(db).map((a) => a.state), ['queued', 'queued']);
  phone.sendWith = 'auth';
  await worker.tick();
  assert.deepEqual(attempts(db).map((a) => a.state), ['failed', 'queued']);
  assert.equal((db.prepare('SELECT status FROM send_batches').get() as { status: string }).status, 'paused');
  phone.sendWith = 'accept';
  await worker.tick();
  assert.equal(attempts(db)[1].state, 'queued'); // paused: nothing more goes out
  assert.equal(controlBatch(db, r.batchId, 'stop', null).ok, true);
  assert.deepEqual(attempts(db).map((a) => a.state), ['failed', 'cancelled']);
});

test('a call that reached the customer after queuing stops the SMS before it goes', async (t) => {
  const { db, dir, a1, a2 } = await setup(t);
  const phone = fakePhone();
  queueMessage(db, { phone: '012 345 678', parcelIds: [a1, a2], text: 'Hi Dara' }, null);
  recordContact(db, { phone: '012 345 678', parcelIds: [a1, a2], channel: 'call', outcome: 'answered' }, null);
  await smsWorker(db, dir, silent, { make: () => phone.gate }).tick();
  assert.deepEqual([attempts(db)[0].state, attempts(db)[0].error_code], ['cancelled', 'reached']);
  assert.equal(phone.sends.length, 0);
  const events = listContactEvents(db);
  assert.equal(events.find((e) => e.channel === 'call')?.outcome, 'answered');
});

test('a retry with the same text is a new attempt of the same message; an edited one is a new message', async (t) => {
  const { db, dir, a1 } = await setup(t);
  const phone = fakePhone();
  const worker = smsWorker(db, dir, silent, { make: () => phone.gate });
  const first = queueMessage(db, { phone: '012 345 678', parcelIds: [a1], text: 'Hi Dara' }, null);
  assert.ok(first.ok);
  await worker.tick();
  phone.set(attempts(db)[0].id, 'Failed', 'RESULT_ERROR_GENERIC_FAILURE');
  await worker.tick();
  assert.equal(attempts(db)[0].state, 'failed');
  assert.match(listContactEvents(db)[0].result ?? '', /RESULT_ERROR_GENERIC_FAILURE/);

  const retry = queueMessage(db, { phone: '012 345 678', parcelIds: [a1], text: 'Hi Dara', retryOf: first.notificationId }, null);
  assert.ok(retry.ok);
  assert.equal(retry.notificationId, first.notificationId);
  assert.deepEqual(attempts(db).map((a) => a.attempt_no), [1, 2]);
  assert.equal(queueMessage(db, { phone: '012 345 678', parcelIds: [a1], text: 'x', retryOf: first.notificationId }, null).ok, false); // waiting now

  await worker.tick();
  phone.set(attempts(db)[1].id, 'Failed');
  await worker.tick();
  const edited = queueMessage(db, { phone: '012 345 678', parcelIds: [a1], text: 'Hi Dara, edited', retryOf: first.notificationId }, null);
  assert.ok(edited.ok);
  assert.notEqual(edited.notificationId, first.notificationId);
});

test('a second worker does not send while the first holds the lease', async (t) => {
  const { db, dir, a1, b1 } = await setup(t);
  const phone = fakePhone();
  const one = smsWorker(db, dir, silent, { make: () => phone.gate });
  const two = smsWorker(db, dir, silent, { make: () => phone.gate });
  queueMessage(db, { phone: '012 345 678', parcelIds: [a1], text: 'Hi Dara' }, null);
  queueMessage(db, { phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' }, null);
  await one.tick();
  await two.tick();
  assert.equal(phone.sends.length, 1);
  one.release();
  await two.tick();
  assert.equal(phone.sends.length, 2);
});
