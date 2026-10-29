import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contactLine,
  composeMessage,
  groupByPhone,
  eligibleForMessage,
  findByCode,
  matchesSearch,
  smsLink,
  normalizePhone,
  phoneGroup,
  smsInFlight,
  addNewParcels,
  canRetry,
  groupSmsStatus,
  inFilter,
  reachedByStaff,
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

test('a call is history only: it never changes the SMS status, and only a reached customer stops the SMS', () => {
  const events = [
    ev('1', '2026-10-10T09:00:00Z', { parcelCodes: ['A'], smsStatus: 'failed' }),
    ev('2', '2026-10-10T10:00:00Z', { channel: 'call', parcelCodes: ['A'], outcome: 'answered' }),
    ev('3', '2026-10-10T10:00:00Z', { channel: 'call', parcelCodes: ['B'], outcome: 'no-answer' }),
    ev('4', '2026-10-10T10:00:00Z', { channel: 'telegram', parcelCodes: ['C'], outcome: 'messaged' }),
  ];
  assert.equal(smsStatusOf('A', events), 'failed');
  assert.deepEqual(['A', 'B', 'C'].map((c) => reachedByStaff(c, events)), [true, false, false]);
  const group = [p('A', 'x', '012345678'), p('B', 'x', '012345678'), p('C', 'x', '012345678')];
  assert.deepEqual(eligibleForMessage(group, events.slice(1)).map((x) => x.code), ['B', 'C']);
});

test('a new arrival is messaged alone; earlier notified parcels are left out', () => {
  const group = [p('A', 'x', '012345678'), p('B', 'x', '012345678'), p('C', 'x', '012345678')];
  const events = [ev('1', '1', { parcelCodes: ['A', 'B'], smsStatus: 'sent' })];
  const eligible = eligibleForMessage(group, events).map((x) => x.code);
  assert.deepEqual(eligible, ['C']);
  assert.match(composeMessage('Sokha Chan', eligible, '2026-10-23'), /^Hi Sokha, your parcel C has arrived/);
  assert.match(composeMessage('Sokha Chan', ['A', 'B'], '2026-10-23'), /2 new parcels .*: A, B\./);
  assert.equal(composeMessage('Sokha', ['A'], '2026-10-03', { single: '{codes} came on {date}', combined: '' }), 'A came on 03-10-2026');
  assert.equal(composeMessage('Sokha', ['A'], '2026-10-03', { single: 'Hi {name}{newline}{codes}', combined: '' }), 'Hi Sokha\nA');
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

test('filters: SMS Failed reads the SMS status only; a reached call does not take a parcel out of it', () => {
  const events = [
    ev('1', '2026-10-10T09:00:00Z', { parcelCodes: ['A'], smsStatus: 'failed' }),
    ev('2', '2026-10-10T10:00:00Z', { parcelCodes: ['A'], channel: 'call', outcome: 'answered' }),
    ev('3', '2026-10-10T10:00:00Z', { parcelCodes: ['B'], channel: 'call', outcome: 'no-answer' }),
    ev('4', '2026-10-10T11:00:00Z', { parcelCodes: ['B'], channel: 'call', outcome: 'no-answer' }),
  ];
  const pick = (f: Parameters<typeof inFilter>[2]) => ['A', 'B', 'C'].filter((c) => inFilter(p(c, c, '011 111 111'), events, f));
  assert.deepEqual(pick('all'), ['A', 'B', 'C']);
  assert.deepEqual(pick('sms-failed'), ['A']);
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

test('re-imported codes keep their saved phone, name and history', () => {
  const existing = [p('A', 'Sokha', '099 111 222')]; // staff corrected the phone
  const merged = addNewParcels(existing, [p('A', 'Sokha Chan', '012 345 678'), p('B', 'b', '011 111 111'), p('B', 'b', '011 111 111')]);
  assert.deepEqual(merged.map((x) => [x.code, x.phone]), [['A', '099 111 222'], ['B', '011 111 111']]);
});

test("a phone line's summary shows its most urgent SMS status", () => {
  const events = [
    ev('1', '2026-10-10T08:00:00Z', { parcelCodes: ['A'], smsStatus: 'delivered' }),
    ev('2', '2026-10-10T09:00:00Z', { parcelCodes: ['B'], smsStatus: 'failed' }),
    ev('3', '2026-10-10T10:00:00Z', { parcelCodes: ['B'], channel: 'call', outcome: 'answered' }),
  ];
  assert.equal(groupSmsStatus(['A', 'B', 'C'], events), 'failed'); // the answered call does not hide the failed SMS
  assert.equal(groupSmsStatus(['A', 'C'], events), 'delivered'); // C's "not sent" is told by the to-notify count
  assert.equal(groupSmsStatus(['C'], events), 'not-sent');
});

test('the contact line says what one SMS would cover, without repeating the count', () => {
  assert.equal(contactLine(1, 1, 'today').key, 'parcel.contactLine.allNotMessaged');
  assert.deepEqual(contactLine(3, 3, 'today'), { key: 'parcel.contactLine.allNotMessagedMany', vars: { count: 3, day: 'today', toMessage: 3 } });
  assert.equal(contactLine(1, 3, 'yesterday').key, 'parcel.contactLine.some');
  assert.equal(contactLine(0, 2, 'today').key, 'parcel.contactLine.allDoneMany');
});

test('scan lookup finds a stored code whatever its case or spaces', () => {
  const parcels = [{ code: 's000000018' }, { code: 'SPX 123' }] as Parcel[];
  assert.equal(findByCode(parcels, 'S000000018')?.code, 's000000018');
  assert.equal(findByCode(parcels, ' spx123 ')?.code, 'SPX 123');
  assert.equal(findByCode(parcels, 'S000000019'), undefined);
});

test('parcels search finds a code, a name or a phone whatever its format', () => {
  const p = { code: 'SPX 123456', recipient: 'Sokha Chan', phone: '012 345 678' } as Parcel;
  for (const q of ['spx123', 'SPX 1234', '3456', 'sokha', ' CHAN ', '012345678', '+855 12 345 678', '345-678', ''])
    assert.equal(matchesSearch(p, q), true, q);
  for (const q of ['SPX 9', 'dara', '999 999'])
    assert.equal(matchesSearch(p, q), false, q);
});

test("the SMS link opens the phone's own messaging app with the number and the message filled in", () => {
  assert.equal(smsLink('012 345 678', 'Hi Dara: 2 parcels & more'), 'sms:+85512345678?&body=Hi%20Dara%3A%202%20parcels%20%26%20more');
});

test('v0.2.1: an SMS held back from an earlier day can be sent again; any SMS leaves the list once staff told the customer by hand', () => {
  const sms = (id: string, at: string, extra: Partial<ContactEvent>): ContactEvent => ({ id, at, channel: 'sms', phone: '012345678', parcelCodes: ['A'], ...extra });
  const held = sms('sms-1', '2026-10-27T03:00:00Z', { smsStatus: 'not-sent', heldSince: '2026-10-27' });
  const stopped = sms('sms-2', '2026-10-27T03:00:00Z', { smsStatus: 'not-sent' }); // a stopped batch: nothing to do
  assert.equal(canRetry(held, [held]), true);
  assert.equal(canRetry(stopped, [stopped]), false);

  const failed = sms('sms-3', '2026-10-29T03:00:00Z', { smsStatus: 'failed' });
  const told = (outcome: ContactEvent['outcome'], at: string): ContactEvent => ({ id: `c-${outcome}-${at}`, at, channel: 'other', phone: '012345678', parcelCodes: ['A'], outcome });
  assert.equal(canRetry(failed, [failed, told('no-answer', '2026-10-29T04:00:00Z')]), true, 'no answer is not telling them');
  assert.equal(canRetry(failed, [failed, told('answered', '2026-10-29T02:00:00Z')]), true, 'told before this SMS: it still failed after');
  assert.equal(canRetry(failed, [failed, told('answered', '2026-10-29T04:00:00Z')]), false);
  assert.equal(canRetry(failed, [failed, told('messaged', '2026-10-29T04:00:00Z')]), false);
  assert.equal(canRetry(held, [held, told('answered', '2026-10-29T04:00:00Z')]), false);
});
