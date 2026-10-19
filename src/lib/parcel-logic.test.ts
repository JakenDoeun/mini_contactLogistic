import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contactLine,
  composeMessage,
  groupByPhone,
  contactStatusOf,
  eligibleForMessage,
  normalizePhone,
  phoneGroup,
  smsInFlight,
  addNewParcels,
  canRetry,
  groupContactStatus,
  groupSmsStatus,
  inFilter,
  smsStatusOf,
  type ContactEvent,
  type Parcel,
} from './parcel-logic.ts';

let id = 0;
const p = (code: string, recipient: string, phone: string, arrivalDate = '2026-10-10'): Parcel => ({
  id: ++id, code, recipient, phone, arrivalDate, importedAt: '2026-10-10T08:00:00Z', sourceFile: 'a.xlsx',
});
const ev = (id: string, at: string, e: Partial<ContactEvent>): ContactEvent => ({ id, at, channel: 'sms', phone: '', parcelCodes: [], ...e });

test('phone formats normalize to one line', () => {
  for (const raw of ['+855 12 345 678', '012-345-678', '12345678', '(012) 345 678']) assert.equal(normalizePhone(raw), '012345678');
});

test('groups by Arrival Batch Date, not import time: the same line on another day is never one group', () => {
  const today = p('A', 'Sokha', '012 345 678', '2026-10-10');
  const yesterday = p('B', 'Sokha', '012 345 678', '2026-10-09'); // imported at the same moment, batch dated a day earlier
  assert.deepEqual(phoneGroup(today, [today, yesterday]).map((x) => x.code), ['A']);
  assert.deepEqual(groupByPhone([today, yesterday]).map((g) => [g.day, g.codes]), [['2026-10-10', ['A']], ['2026-10-09', ['B']]]);
});

test('groups by phone, never by name', () => {
  const a = p('A', 'Sokha Chan', '+855 12 345 678');
  const parcels = [a, p('B', 'Chan Sokha', '012-345-678'), p('C', 'Sokha Chan', '097 111 222')];
  assert.deepEqual(phoneGroup(a, parcels).map((x) => x.code), ['A', 'B']);
});

test('SMS and contact status stay independent', () => {
  const events = [
    ev('1', '2026-10-10T09:00:00Z', { parcelCodes: ['A'], smsStatus: 'failed' }),
    ev('2', '2026-10-10T10:00:00Z', { channel: 'call', parcelCodes: ['A'], outcome: 'answered' }),
  ];
  assert.equal(smsStatusOf('A', events), 'failed');
  assert.equal(contactStatusOf('A', events), 'contacted');
});

test('attempts accumulate instead of overwriting', () => {
  const miss = (id: string, at: string) => ev(id, at, { channel: 'call', parcelCodes: ['A'], outcome: 'no-answer' });
  assert.equal(contactStatusOf('A', [miss('1', '1')]), 'attempted');
  assert.equal(contactStatusOf('A', [miss('1', '1'), miss('2', '2')]), 'follow-up');
  assert.equal(contactStatusOf('B', [miss('1', '1')]), 'needs-contact');
});

test('a new arrival is messaged alone; earlier notified parcels are left out', () => {
  const group = [p('A', 'x', '012345678'), p('B', 'x', '012345678'), p('C', 'x', '012345678')];
  const events = [ev('1', '1', { parcelCodes: ['A', 'B'], smsStatus: 'sent' })];
  const eligible = eligibleForMessage(group, events).map((x) => x.code);
  assert.deepEqual(eligible, ['C']);
  assert.match(composeMessage('Sokha Chan', eligible), /^Hi Sokha, your parcel C has arrived/);
  assert.match(composeMessage('Sokha Chan', ['A', 'B']), /2 new parcels .*: A, B\./);
});

test('an SMS waiting at the gateway blocks a duplicate', () => {
  const events = [ev('1', '1', { parcelCodes: ['A', 'B'], smsStatus: 'queued' })];
  assert.equal(smsInFlight(['B'], events), true);
  assert.equal(smsInFlight(['C'], events), false);
});

test('a failed SMS can be retried once; the retry replaces it', () => {
  const failed = ev('1', '1', { parcelCodes: ['A', 'B'], smsStatus: 'failed' });
  assert.equal(canRetry(failed, [failed]), true);
  const retry = ev('2', '2', { parcelCodes: ['A', 'B'], smsStatus: 'queued' });
  assert.equal(canRetry(failed, [failed, retry]), false);
  const sent = ev('3', '3', { parcelCodes: ['A'], smsStatus: 'sent' });
  assert.equal(canRetry(sent, [sent]), false);
});

test('filters read one status system each: a failed SMS then a reached call is in SMS Failed and Contacted', () => {
  const events = [
    ev('1', '2026-10-10T09:00:00Z', { parcelCodes: ['A'], smsStatus: 'failed' }),
    ev('2', '2026-10-10T10:00:00Z', { parcelCodes: ['A'], channel: 'call', outcome: 'answered' }),
    ev('3', '2026-10-10T10:00:00Z', { parcelCodes: ['B'], channel: 'call', outcome: 'no-answer' }),
    ev('4', '2026-10-10T11:00:00Z', { parcelCodes: ['B'], channel: 'call', outcome: 'no-answer' }),
  ];
  const pick = (f: Parameters<typeof inFilter>[2]) => ['A', 'B', 'C'].filter((c) => inFilter(p(c, c, '011 111 111'), events, f));
  assert.deepEqual(pick('all'), ['A', 'B', 'C']);
  assert.deepEqual(pick('sms-failed'), ['A']);
  assert.deepEqual(pick('contacted'), ['A']);
  assert.deepEqual(pick('follow-up'), ['B']);
  assert.deepEqual(pick('needs-contact'), ['C']);
});

test('a missing or invalid phone never groups, even with the same name', () => {
  const a = p('A', 'Dara Kim', '');
  const parcels = [a, p('B', 'Dara Kim', ''), p('C', 'Dara Kim', '012 34'), p('D', 'Dara Kim', '012 345 678')];
  assert.deepEqual(phoneGroup(a, parcels).map((x) => x.code), ['A']);
  assert.deepEqual(phoneGroup(parcels[2], parcels).map((x) => x.code), ['C']);
  assert.deepEqual(eligibleForMessage(parcels, []).map((x) => x.code), ['D']);
  assert.ok(inFilter(a, [], 'no-phone') && !inFilter(parcels[3], [], 'no-phone'));
});

test('adding a phone number puts the parcel into its phone group', () => {
  const parcels = [p('A', 'a', ''), p('B', 'b', '012 345 678')];
  const fixed = parcels.map((x) => (x.code === 'A' ? { ...x, phone: '+855 12 345 678' } : x));
  assert.deepEqual(phoneGroup(fixed[0], fixed).map((x) => x.code), ['A', 'B']);
});

test('a follow-up flag holds over earlier contact and clears only on a later answered call', () => {
  const flag = ev('2', '2026-10-10T10:00:00Z', { parcelCodes: ['A'], channel: 'flag', outcome: 'follow-up' });
  const answered = (at: string) => ev(at, at, { parcelCodes: ['A'], channel: 'call', outcome: 'answered' });
  assert.equal(contactStatusOf('A', [flag]), 'follow-up');
  assert.equal(contactStatusOf('A', [answered('2026-10-10T09:00:00Z'), flag]), 'follow-up');
  assert.equal(contactStatusOf('A', [flag, answered('2026-10-10T11:00:00Z')]), 'contacted');
  const noAnswer = ev('3', '2026-10-10T11:00:00Z', { parcelCodes: ['B'], channel: 'call', outcome: 'no-answer' });
  const flagB = { ...flag, id: '4', parcelCodes: ['B'] };
  assert.equal(contactStatusOf('B', [flagB, noAnswer]), 'follow-up'); // a no-answer does not resolve it
});

test('re-imported codes keep their saved phone, name and history', () => {
  const existing = [p('A', 'Sokha', '099 111 222')]; // staff corrected the phone
  const merged = addNewParcels(existing, [p('A', 'Sokha Chan', '012 345 678'), p('B', 'b', '011 111 111'), p('B', 'b', '011 111 111')]);
  assert.deepEqual(merged.map((x) => [x.code, x.phone]), [['A', '099 111 222'], ['B', '011 111 111']]);
});

test("a phone line's summary shows its most urgent SMS and contact status, each system on its own", () => {
  const events = [
    ev('1', '2026-10-10T08:00:00Z', { parcelCodes: ['A'], smsStatus: 'delivered' }),
    ev('2', '2026-10-10T09:00:00Z', { parcelCodes: ['B'], smsStatus: 'failed' }),
    ev('3', '2026-10-10T10:00:00Z', { parcelCodes: ['B'], channel: 'call', outcome: 'answered' }),
  ];
  assert.equal(groupSmsStatus(['A', 'B', 'C'], events), 'failed'); // the answered call does not hide the failed SMS
  assert.equal(groupSmsStatus(['A', 'C'], events), 'delivered'); // C's "not sent" is told by the to-notify count
  assert.equal(groupSmsStatus(['C'], events), 'not-sent');
  assert.equal(groupContactStatus(['B'], events), 'contacted');
  assert.equal(groupContactStatus(['A', 'B'], events), 'needs-contact'); // A still has to be reached
});

test('the contact line says what one SMS would cover, without repeating the count', () => {
  assert.equal(contactLine(1, 1, 'today'), 'Not messaged yet');
  assert.equal(contactLine(3, 3, 'today'), 'Not messaged yet · one SMS covers all 3 parcels on this number today');
  assert.equal(contactLine(1, 3, 'yesterday'), '1 of 3 parcels on this number yesterday not messaged yet');
  assert.equal(contactLine(0, 2, 'today'), 'Messaged or reached already · all 2 parcels on this number today');
});
