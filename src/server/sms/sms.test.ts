import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from '../db/connection.ts';
import { insertNewParcels } from '../db/parcels.ts';
import { createTestDb } from '../db/test-db.ts';
import { cambodiaDate } from '../db/values.ts';
import { readSetting } from '../db/settings.ts';
import { confirmSim, routeFor, scanSims } from '../gateway/sims.ts';
import { GATEWAY_FILE, GatewayError, writeGatewayConfig, type MessageState, type SimCard, type SmsGate } from '../gateway/smsgate.ts';
import {
  controlBatch,
  gatewayState,
  holdAfterRestore,
  listContactEvents,
  notifyDay,
  queueMessage,
  recordContact,
  releaseRestoreHold,
  restoreHold,
  SIM_MISSING,
  SIM_PAUSE,
} from './queue.ts';
import { randomGap, smsWorker } from './worker.ts';

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
    sendSims: [] as (number | null | undefined)[],
    simCards: [] as SimCard[],
    sendWith: 'accept' as 'accept' | 'timeout' | 'timeout-lost' | 'unreachable' | 'auth',
    lookupFails: false,
    messages,
    gate: {
      async send(m: { id: string; simNumber?: number | null }) {
        phone.sends.push(m.id);
        phone.sendSims.push(m.simNumber);
        if (phone.sendWith === 'unreachable') throw new GatewayError('unreachable', 'away');
        if (phone.sendWith === 'auth') throw new GatewayError('auth', 'bad password');
        const duplicate = messages.has(m.id);
        if (phone.sendWith !== 'timeout-lost' && !duplicate) messages.set(m.id, { id: m.id, state: 'Pending', states: {}, error: null });
        if (phone.sendWith !== 'accept') return { outcome: 'unknown' as const, reason: 'timeout' };
        return { outcome: 'accepted' as const, duplicate };
      },
      async sims() {
        if (phone.lookupFails) throw new GatewayError('unreachable', 'away');
        return phone.simCards;
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
  const r = notifyDay(db, { requestKey: key, day: TODAY, items }, null);
  assert.ok(r.ok);
  assert.deepEqual([r.queued, r.skipped], [1, 2]);
  const again = notifyDay(db, { requestKey: key, day: TODAY, items }, null);
  assert.ok(again.ok && again.repeated);
  assert.equal(attempts(db).length, 1);
  const none = notifyDay(db, { requestKey: crypto.randomUUID(), day: TODAY, items }, null);
  assert.deepEqual(none.ok ? null : none.error, 'batch_running'); // one batch at a time
  db.prepare(`UPDATE send_batches SET status = 'done'`).run();
  const nothing = notifyDay(db, { requestKey: crypto.randomUUID(), day: TODAY, items }, null);
  assert.deepEqual(nothing.ok ? null : nothing.error, 'nothing_to_send'); // Dara is queued now, Sokha reached
});

test('the worker hands messages over one at a time and follows the phone to Delivered', async (t) => {
  const { db, dir, a1, b1 } = await setup(t);
  const phone = fakePhone();
  let clock = Date.now();
  const worker = smsWorker(db, dir, silent, { gap: () => 0, make: () => phone.gate, now: () => clock });
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
  await smsWorker(db, dir, silent, { gap: () => 0, make: () => phone.gate }).tick();
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
  await smsWorker(db, dir, silent, { gap: () => 0, make: () => phone.gate }).tick();
  assert.equal(attempts(db)[0].state, 'unconfirmed');
});

test('a hand-over with no answer is looked up by ID; one the phone never got goes again under the same ID', async (t) => {
  const { db, dir, a1, b1 } = await setup(t);
  const phone = fakePhone();
  const worker = smsWorker(db, dir, silent, { gap: () => 0, make: () => phone.gate });
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
  const worker = smsWorker(db, dir, silent, { gap: () => 0, make: () => phone.gate });
  const r = notifyDay(db, { requestKey: crypto.randomUUID(), day: TODAY, items: [
    { phone: '012 345 678', parcelIds: [a1, a2], text: 'Hi Dara' },
    { phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' },
  ] }, null);
  assert.ok(r.ok);
  assert.deepEqual(gatewayState(db, dir), { setUp: true, awaySince: null });
  phone.sendWith = 'unreachable';
  await worker.tick();
  assert.deepEqual(attempts(db).map((a) => a.state), ['queued', 'queued']);
  const since = gatewayState(db, dir).awaySince;
  assert.ok(since); // the pages say the phone is not answering
  await worker.tick();
  assert.equal(gatewayState(db, dir).awaySince, since); // still the first time it did not answer
  phone.sendWith = 'auth';
  await worker.tick();
  assert.equal(gatewayState(db, dir).awaySince, null); // it answered, even if with a refusal
  assert.deepEqual(attempts(db).map((a) => a.state), ['failed', 'queued']);
  assert.equal((db.prepare('SELECT status FROM send_batches').get() as { status: string }).status, 'paused');
  phone.sendWith = 'accept';
  await worker.tick();
  assert.equal(attempts(db)[1].state, 'queued'); // paused: nothing more goes out
  assert.equal(controlBatch(db, r.batchId, 'stop', null).ok, true);
  assert.deepEqual(attempts(db).map((a) => a.state), ['failed', 'cancelled']);
});

test('with no gateway phone set up, messages wait and the pages are told why', async (t) => {
  const { db, dir, b1 } = await setup(t);
  fs.rmSync(path.join(dir, GATEWAY_FILE));
  const phone = fakePhone();
  queueMessage(db, { phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' }, null);
  await smsWorker(db, dir, silent, { gap: () => 0, make: () => phone.gate }).tick();
  assert.deepEqual(gatewayState(db, dir), { setUp: false, awaySince: null });
  assert.equal(attempts(db)[0].state, 'queued');
  assert.equal(phone.sends.length, 0);
  fs.writeFileSync(path.join(dir, GATEWAY_FILE), '{"url":"http://phone:8080"}'); // incomplete: unusable as well
  assert.equal(gatewayState(db, dir).setUp, false);
});

test('a call that reached the customer after queuing stops the SMS before it goes', async (t) => {
  const { db, dir, a1, a2 } = await setup(t);
  const phone = fakePhone();
  queueMessage(db, { phone: '012 345 678', parcelIds: [a1, a2], text: 'Hi Dara' }, null);
  recordContact(db, { phone: '012 345 678', parcelIds: [a1, a2], channel: 'call', outcome: 'answered' }, null);
  await smsWorker(db, dir, silent, { gap: () => 0, make: () => phone.gate }).tick();
  assert.deepEqual([attempts(db)[0].state, attempts(db)[0].error_code], ['cancelled', 'reached']);
  assert.equal(phone.sends.length, 0);
  const events = listContactEvents(db);
  assert.equal(events.find((e) => e.channel === 'call')?.outcome, 'answered');
});

test('a retry with the same text is a new attempt of the same message; an edited one is a new message', async (t) => {
  const { db, dir, a1 } = await setup(t);
  const phone = fakePhone();
  const worker = smsWorker(db, dir, silent, { gap: () => 0, make: () => phone.gate });
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
  const one = smsWorker(db, dir, silent, { gap: () => 0, make: () => phone.gate });
  const two = smsWorker(db, dir, silent, { gap: () => 0, make: () => phone.gate });
  queueMessage(db, { phone: '012 345 678', parcelIds: [a1], text: 'Hi Dara' }, null);
  queueMessage(db, { phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' }, null);
  await one.tick();
  await two.tick();
  assert.equal(phone.sends.length, 1);
  one.release();
  await two.tick();
  assert.equal(phone.sends.length, 2);
});

test('an earlier day goes only as its own batch, after staff confirm they checked, and never with today', async (t) => {
  const { db, a1, y1 } = await setup(t);
  const items = [
    { phone: '012 345 678', parcelIds: [y1], text: 'Hi Dara, from yesterday' },
    { phone: '012 345 678', parcelIds: [a1], text: 'Hi Dara, today' }, // today's line: never rides along
  ];
  const unchecked = notifyDay(db, { requestKey: crypto.randomUUID(), day: YESTERDAY, items }, null);
  assert.deepEqual(unchecked.ok ? null : unchecked.error, 'not_checked');
  const r = notifyDay(db, { requestKey: crypto.randomUUID(), day: YESTERDAY, items, checked: true }, null);
  assert.ok(r.ok);
  assert.deepEqual([r.queued, r.skipped], [1, 1]);
  assert.equal((db.prepare('SELECT arrival_date FROM send_batches').get() as { arrival_date: string }).arrival_date, YESTERDAY);
  assert.deepEqual(listContactEvents(db).map((e) => e.parcelCodes), [['Y1']]);
  // One batch at a time: today's waits until yesterday's finishes or is stopped.
  const today = notifyDay(db, { requestKey: crypto.randomUUID(), day: TODAY, items: [items[1]] }, null);
  assert.deepEqual(today.ok ? null : today.error, 'batch_running');
  const future = notifyDay(db, { requestKey: crypto.randomUUID(), day: '2999-01-01', items, checked: true }, null);
  assert.equal(future.ok, false);
});

test('after a restore nothing is sent until staff check the phone; customers they saw an SMS for are saved as Sent', async (t) => {
  const { db, dir, a1, a2, b1 } = await setup(t);
  queueMessage(db, { phone: '012 345 678', parcelIds: [a1, a2], text: 'Hi Dara' }, null); // queued in the copy
  holdAfterRestore(db, new Date(Date.now() - 3600_000));
  assert.ok(restoreHold(db));
  const single = queueMessage(db, { phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' }, null);
  assert.deepEqual(single.ok ? null : single.error, 'restore_hold');
  const batch = notifyDay(db, { requestKey: crypto.randomUUID(), day: TODAY, items: [{ phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' }] }, null);
  assert.deepEqual(batch.ok ? null : batch.error, 'restore_hold');
  const phone = fakePhone();
  const worker = smsWorker(db, dir, silent, { gap: () => 0, make: () => phone.gate });
  await worker.tick();
  assert.equal(phone.sends.length, 0); // the queued one waits too

  // Staff saw on the phone that Sokha already got one after the copy.
  assert.equal(releaseRestoreHold(db, [{ phone: '097 880 1123', parcelIds: [b1] }], null).ok, true);
  assert.equal(restoreHold(db), null);
  const sokha = listContactEvents(db).find((e) => e.parcelCodes[0] === 'B1');
  assert.equal(sokha?.smsStatus, 'sent');
  assert.match(sokha?.result ?? '', /gateway phone after a restore/);
  assert.equal(queueMessage(db, { phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' }, null).ok, false); // never twice
  await worker.tick();
  assert.equal(phone.sends.length, 1); // Dara's queued message goes now
  assert.equal(releaseRestoreHold(db, [], null).ok, false);
});

test('a refused line in the restore check saves nothing and keeps the hold', async (t) => {
  const { db, a1, b1 } = await setup(t);
  holdAfterRestore(db, new Date());
  const r = releaseRestoreHold(db, [{ phone: '012 345 678', parcelIds: [a1] }, { phone: '012 345 678', parcelIds: [b1] }], null);
  assert.equal(r.ok, false);
  assert.ok(restoreHold(db));
  assert.equal(listContactEvents(db).length, 0);
});

test('a random gap between two SMS (25 to 80 seconds unless the admin changes it), also after a restart', async (t) => {
  const { db, dir, a1, b1 } = await setup(t);
  const phone = fakePhone();
  let clock = Date.now();
  const worker = smsWorker(db, dir, silent, { make: () => phone.gate, now: () => clock, gap: () => 30_000 });
  queueMessage(db, { phone: '012 345 678', parcelIds: [a1], text: 'Hi Dara' }, null);
  queueMessage(db, { phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' }, null);
  await worker.tick();
  clock += 29_000;
  await worker.tick();
  assert.equal(phone.sends.length, 1);
  worker.release();
  // A restarted worker still waits for the gap from the last hand-over it finds in the database.
  const restarted = smsWorker(db, dir, silent, { make: () => phone.gate, now: () => clock, gap: () => 30_000 });
  await restarted.tick();
  assert.equal(phone.sends.length, 1);
  clock += 32_000;
  await restarted.tick();
  assert.equal(phone.sends.length, 2);

  const gaps = Array.from({ length: 500 }, () => randomGap({ from: 25, to: 80 }));
  assert.ok(gaps.every((g) => g >= 25_000 && g <= 80_000));
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 30_000); // spread out, not one fixed pause
  assert.ok(Array.from({ length: 100 }, () => randomGap({ from: 15, to: 15 })).every((g) => g === 15_000));
});

// ---- Phase 12: one dual-SIM gateway phone, each SMS from its customer's carrier ----------------------------------

const CELLCARD_SMART: SimCard[] = [
  { simNumber: 1, carrierName: 'Cellcard', phoneNumber: null },
  { simNumber: 2, carrierName: 'SMART', phoneNumber: null },
];
const simOf = (db: Db, id: string) => db.prepare('SELECT sim_number FROM sms_attempts WHERE id = ?').pluck().get(id);

test("Phase 12: each SMS goes from its carrier's SIM; a carrier with no confirmed SIM is left to contact by hand", async (t) => {
  const { db, dir, a1, a2, b1 } = await setup(t);
  const phone = fakePhone();
  phone.simCards = CELLCARD_SMART;
  const make = () => phone.gate;
  const scanned = await scanSims(db, dir, make);
  assert.deepEqual(scanned.sims.map((s) => [s.simNumber, s.suggested, s.carrier]), [[1, 'cellcard', null], [2, 'smart', null]]);
  assert.equal(routeFor(scanned)('012 345 678'), null, 'nothing is routed before a staff member confirms the SIM');

  assert.ok(confirmSim(db, null, { simNumber: 1, carrier: 'cellcard' }).ok);
  const route = routeFor((await scanSims(db, dir, make)));
  assert.equal(route('012 345 678'), 1);
  assert.equal(route('097 880 1123'), null, 'Metfone: no Metfone SIM in the phone');

  const onlyByHand = notifyDay(db, { requestKey: crypto.randomUUID(), day: TODAY, items: [{ phone: '097 880 1123', parcelIds: [b1], text: 'Hi' }] }, null, new Date(), route);
  assert.equal(onlyByHand.ok ? '' : onlyByHand.error, 'no_sim');
  const r = notifyDay(db, { requestKey: crypto.randomUUID(), day: TODAY, items: [
    { phone: '012 345 678', parcelIds: [a1, a2], text: 'Hi Dara' },
    { phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' },
  ] }, null, new Date(), route);
  assert.ok(r.ok);
  assert.deepEqual([r.queued, r.byHand], [1, 1]);
  assert.equal(listContactEvents(db).filter((e) => e.channel === 'sms').length, 1, 'the Metfone customer gets no SMS record');

  const single = queueMessage(db, { phone: '097 880 1123', parcelIds: [b1], text: 'Hi Sokha' }, null, undefined, route);
  assert.equal(single.ok ? '' : single.error, 'no_sim');

  await smsWorker(db, dir, silent, { gap: () => 0, make }).tick();
  assert.deepEqual(phone.sendSims, [1]);
  assert.equal(simOf(db, phone.sends[0]), 1);
  assert.equal(listContactEvents(db).find((e) => e.channel === 'sms')?.sim, 1);
});

test('Phase 12: a SIM taken out or swapped makes its SMS wait; they go once the same SIM is back', async (t) => {
  const { db, dir, a1, a2 } = await setup(t);
  const phone = fakePhone();
  phone.simCards = CELLCARD_SMART;
  const make = () => phone.gate;
  await scanSims(db, dir, make);
  confirmSim(db, null, { simNumber: 1, carrier: 'cellcard' });
  const route = routeFor(await scanSims(db, dir, make));
  assert.ok(queueMessage(db, { phone: '012 345 678', parcelIds: [a1, a2], text: 'Hi Dara' }, null, undefined, route).ok);
  const worker = smsWorker(db, dir, silent, { gap: () => 0, make });

  phone.simCards = [CELLCARD_SMART[1]]; // SIM 1 taken out
  await worker.tick();
  assert.equal(phone.sends.length, 0);
  assert.deepEqual((readSetting(db, SIM_MISSING) as { sims: number[] }).sims, [1]);

  phone.simCards = [{ simNumber: 1, carrierName: 'Metfone', phoneNumber: null }, CELLCARD_SMART[1]]; // another carrier's SIM
  await worker.tick();
  assert.equal(phone.sends.length, 0, 'a swapped SIM is not used until someone confirms it');

  phone.simCards = CELLCARD_SMART;
  await worker.tick();
  assert.deepEqual(phone.sendSims, [1]);
  assert.equal(readSetting(db, SIM_MISSING), undefined);
});

test('Phase 12: two failures in a row on one SIM pause the run; Resume carries on and clears the note', async (t) => {
  const { db, dir } = await setup(t);
  const phone = fakePhone();
  phone.simCards = CELLCARD_SMART;
  const make = () => phone.gate;
  await scanSims(db, dir, make);
  confirmSim(db, null, { simNumber: 1, carrier: 'cellcard' });
  const route = routeFor(await scanSims(db, dir, make));
  const importId = db.prepare('SELECT id FROM imports').pluck().get() as number;
  const { inserted } = insertNewParcels(db, importId, ['011 111 111', '011 222 222', '011 333 333'].map((p, i) => ({ trackingCode: `C${i}`, recipientName: 'X', phoneRaw: p, arrivalDate: TODAY })));
  const r = notifyDay(db, { requestKey: crypto.randomUUID(), day: TODAY, items: inserted.map((id, i) => ({ phone: ['011 111 111', '011 222 222', '011 333 333'][i], parcelIds: [id], text: 'Hi' })) }, null, new Date(), route);
  assert.ok(r.ok);
  const worker = smsWorker(db, dir, silent, { gap: () => 0, make });

  await worker.tick();
  phone.set(phone.sends[0], 'Failed', 'RESULT_ERROR_GENERIC_FAILURE');
  await worker.tick(); // the first failure is seen, the second SMS goes
  assert.equal(phone.sends.length, 2);
  phone.set(phone.sends[1], 'Failed', 'RESULT_ERROR_GENERIC_FAILURE');
  await worker.tick(); // the second failure pauses the run before the third SMS
  assert.equal(phone.sends.length, 2);
  assert.equal(db.prepare('SELECT status FROM send_batches WHERE id = ?').pluck().get(r.ok && r.batchId), 'paused');
  assert.equal((readSetting(db, SIM_PAUSE) as { sim: number }).sim, 1);

  assert.ok(controlBatch(db, r.ok ? r.batchId : 0, 'resume', null).ok);
  assert.equal(readSetting(db, SIM_PAUSE), undefined);
  await worker.tick();
  assert.equal(phone.sends.length, 3);
});

test('Phase 12: an SMS sent from another phone is recorded in the history', async (t) => {
  const { db, b1 } = await setup(t);
  assert.ok(recordContact(db, { phone: '097 880 1123', parcelIds: [b1], channel: 'other', outcome: 'messaged' }, null).ok);
  assert.equal(recordContact(db, { phone: '097 880 1123', parcelIds: [b1], channel: 'other', outcome: 'answered' }, null).ok, false);
  const e = listContactEvents(db).find((x) => x.channel === 'other');
  assert.deepEqual([e?.outcome, e?.parcelCodes], ['messaged', ['B1']]);
});
