import test from 'node:test';
import assert from 'node:assert/strict';
import { byHandGroups, dayProgress, planNotify, workList } from './dashboard-logic.ts';
import { arrivalDay, smsStatusOf, type ContactEvent, type Parcel } from './parcel-logic.ts';

let n = 0;
const parcel = (code: string, recipient: string, phone: string, h = 1): Parcel => {
  const importedAt = new Date(Date.UTC(2026, 9, 12, 12 - h)).toISOString();
  return { id: ++n, code, recipient, phone, arrivalDate: arrivalDay(importedAt), importedAt, sourceFile: 'a.xlsx' };
};
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
    [['C'], ['D']], // A was messaged, B is waiting at the gateway; unanswered calls do not stop C's SMS
  );
  assert.equal(w.inFlight, 1);
});

test('a failed SMS then an answered call: SMS stays Failed and nothing is sent again', () => {
  const parcels = [parcel('A', 'a', '011 111 111')];
  const events = [event(['A'], { smsStatus: 'failed' }), event(['A'], { channel: 'call', outcome: 'answered' })];
  assert.equal(smsStatusOf('A', events), 'failed');
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

test("day progress: each of the day's parcels counted once, the most settled state first; other days ignored", () => {
  const day = arrivalDay(new Date(Date.UTC(2026, 9, 12, 11)).toISOString());
  const parcels = [
    parcel('D1', 'A', '012 000 001'), // SMS sent
    parcel('D2', 'B', '012 000 002'), // reached by phone, also has a failed SMS: reached wins
    parcel('D3', 'C', '012 000 003'), // queued
    parcel('D4', 'D', '012 000 004'), // unconfirmed
    parcel('D5', 'E', ''), // no phone
    parcel('D6', 'F', '012 000 006'), // nothing yet
    parcel('OLD', 'G', '012 000 007', 40), // an earlier day
  ];
  const events = [
    event(['D1'], { smsStatus: 'sent' }),
    event(['D2'], { smsStatus: 'failed' }),
    event(['D2'], { channel: 'call', outcome: 'answered', smsStatus: undefined }),
    event(['D3'], { smsStatus: 'queued' }),
    event(['D4'], { smsStatus: 'unconfirmed' }),
  ];
  assert.deepEqual(dayProgress(parcels, events, day), { done: 2, sending: 1, retry: 1, noPhone: 1, notYet: 1 });
});

test('contact by hand: grouped by network, never-tried first, no answer after, told lines counted as done', () => {
  const sims = [{ simNumber: 1, carrierName: 'Cellcard', phoneNumber: null, suggested: 'cellcard' as const, carrier: 'cellcard' as const }];
  const parcels = [
    parcel('C1', 'Dara', '012 000 111'), // Cellcard: texted by the gateway, not by hand
    parcel('M1', 'Sokha', '097 000 1111'),
    parcel('M2', 'Nita', '088 000 2222'),
    parcel('M3', 'Mony', '060 000 333'),
    parcel('M4', 'Lina', '066 000 444'),
    parcel('U1', 'Piseth', '019 000 555'),
  ];
  const now = new Date(parcels[0].importedAt);
  const events = [
    event(['M2'], { channel: 'call', outcome: 'no-answer', phone: '0880002222' }),
    event(['M3'], { channel: 'call', outcome: 'answered', phone: '060000333' }), // reached: done
    event(['M4'], { channel: 'other', outcome: 'messaged', phone: '066000444' }), // SMS from a staff phone: done
  ];
  const groups = byHandGroups(planNotify(parcels, events, now), parcels, events, sims, now);
  assert.deepEqual(
    groups.map((g) => [g.carrier, g.lines.map((l) => l.codes[0]), g.notContacted, g.noAnswer, g.done]),
    [
      ['metfone', ['M1', 'M2'], 1, 1, 2],
      [null, ['U1'], 1, 0, 0],
    ],
  );
  assert.equal(groups[0].lines[1].tries, 1);
});
