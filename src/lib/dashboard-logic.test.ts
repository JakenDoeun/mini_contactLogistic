import test from 'node:test';
import assert from 'node:assert/strict';
import { planNotify, workList } from './dashboard-logic.ts';
import { contactStatusOf, smsStatusOf, type ContactEvent, type Parcel } from './parcel-logic.ts';

const parcel = (code: string, recipient: string, phone: string, h = 1): Parcel => ({
  code,
  recipient,
  phone,
  importedAt: new Date(Date.UTC(2026, 9, 12, 12 - h)).toISOString(),
  sourceFile: 'a.xlsx',
});
let n = 0;
const event = (codes: string[], extra: Partial<ContactEvent>): ContactEvent => ({
  id: `e${n++}`,
  at: new Date(Date.UTC(2026, 9, 12, n)).toISOString(),
  channel: 'sms',
  phone: '012345678',
  parcelCodes: codes,
  ...extra,
});

test('unmessaged parcels are grouped by phone, not by name, with the newest name shown', () => {
  const parcels = [
    parcel('A', 'Sokha Chan', '012 345 678', 3),
    parcel('B', 'Chan Sokha', '+855 12 345 678', 1),
    parcel('C', 'Sokha Chan', '096 555 2041'), // same name, other line: stays separate
  ];
  const { toMessage } = workList(parcels, []);
  assert.deepEqual(
    toMessage.map((g) => [g.phone, g.recipient, g.codes]),
    [
      ['012345678', 'Chan Sokha', ['B', 'A']],
      ['0965552041', 'Sokha Chan', ['C']],
    ],
  );
});

test('messaged, reached, queued and retryable parcels land in the right places', () => {
  const parcels = [parcel('A', 'a', '011 111 111'), parcel('B', 'b', '022 222 222'), parcel('C', 'c', '033 333 333'), parcel('D', 'd', '044 444 444')];
  const failed = event(['A'], { smsStatus: 'failed' });
  const events = [
    failed,
    event(['B'], { smsStatus: 'queued' }),
    event(['C'], { channel: 'call', outcome: 'no-answer' }),
    event(['C'], { channel: 'call', outcome: 'no-answer' }),
  ];
  const w = workList(parcels, events);
  assert.deepEqual(w.retry, [failed]);
  assert.deepEqual(
    w.toMessage.map((g) => g.codes),
    [['C'], ['D']], // A was messaged, B is waiting at the gateway
  );
  assert.deepEqual(w.followUp.map((g) => g.codes), [['C']]);
  assert.equal(w.inFlight, 1);
});

test('a failed SMS then an answered call: SMS stays Failed, contact becomes Contacted', () => {
  const parcels = [parcel('A', 'a', '011 111 111')];
  const events = [event(['A'], { smsStatus: 'failed' }), event(['A'], { channel: 'call', outcome: 'answered' })];
  assert.equal(smsStatusOf('A', events), 'failed');
  assert.equal(contactStatusOf('A', events), 'contacted');
  assert.equal(workList(parcels, events).toMessage.length, 0);
});

test('group size counts every parcel on the phone, while codes list only the ones the item is about', () => {
  const parcels = [parcel('A', 'a', '011 111 111', 3), parcel('B', 'b', '011 111 111', 2), parcel('C', 'c', '011 111 111', 1)];
  const events = [event(['A'], { smsStatus: 'delivered' })];
  const [g] = workList(parcels, events).toMessage;
  assert.deepEqual([g.codes, g.size], [['C', 'B'], 3]); // A was notified, so the combined SMS leaves it out
});

test('parcels without a valid phone are never grouped or messaged, only listed to fix', () => {
  const parcels = [parcel('A', 'Dara Kim', ''), parcel('B', 'Dara Kim', ''), parcel('C', 'x', '012 34'), parcel('D', 'd', '011 111 111')];
  const w = workList(parcels, []);
  assert.deepEqual(w.toMessage.map((g) => g.codes), [['D']]);
  assert.deepEqual(w.noPhone.map((p) => p.code).sort(), ['A', 'B', 'C']);
});

test('a staff follow-up flag lists the whole phone line until someone reaches the customer', () => {
  const parcels = [parcel('A', 'a', '011 111 111'), parcel('B', 'b', '011 111 111')];
  const flagged = [event(['A', 'B'], { channel: 'flag', outcome: 'follow-up' })];
  assert.deepEqual(workList(parcels, flagged).followUp.map((g) => [g.codes.sort(), g.size]), [[['A', 'B'], 2]]);
  const resolved = [...flagged, event(['A', 'B'], { channel: 'call', outcome: 'answered' })];
  assert.equal(workList(parcels, resolved).followUp.length, 0);
});

test("notify today's customers: one SMS per phone in today's batch only; notified, in-flight and phoneless left out", () => {
  const now = new Date(Date.UTC(2026, 9, 12, 12));
  const parcels = [
    parcel('A1', 'Sokha', '012 345 678', 1), // today
    parcel('A2', 'Sokha Chan', '+855 12 345 678', 2), // today, same line
    parcel('A3', 'Sokha', '012 345 678', 30), // yesterday, same line, not notified: its own batch, never joins today's SMS
    parcel('A4', 'Sokha', '012 345 678', 31), // yesterday, already notified
    parcel('B1', 'Dara', '097 880 1123', 1), // today, alone: individual SMS
    parcel('C1', 'Vanna', '', 1), // today, no phone
    parcel('D1', 'Piseth', '011 222 333', 1), // today, but an SMS is waiting at the gateway
    parcel('E1', 'Malis', '015 774 320', 40), // older only
  ];
  const events = [event(['A4'], { smsStatus: 'delivered' }), event(['D1'], { smsStatus: 'queued' })];
  const plan = planNotify(parcels, events, now);
  assert.deepEqual(
    plan.today.map((i) => [i.phone, i.codes]),
    [
      ['012345678', ['A1', 'A2']],
      ['0978801123', ['B1']],
    ],
  );
  assert.match(plan.today[0].message, /2 new parcels/);
  assert.doesNotMatch(plan.today[0].message, /A3/);
  assert.match(plan.today[1].message, /your parcel B1/);
  assert.deepEqual(plan.older.map((i) => i.codes), [['A3'], ['E1']]);
  assert.deepEqual(plan.noPhoneToday.map((p) => p.code), ['C1']);
});

test('re-importing yesterday\'s file adds nothing to today and sends nothing', () => {
  const now = new Date(Date.UTC(2026, 9, 12, 12));
  const parcels = [parcel('Y1', 'Sokha', '012 345 678', 30)];
  const events = [event(['Y1'], { smsStatus: 'delivered' })];
  const plan = planNotify(parcels, events, now);
  assert.deepEqual([plan.today.length, plan.older.length], [0, 0]);
});
