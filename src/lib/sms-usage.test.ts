import test from 'node:test';
import assert from 'node:assert/strict';
import { periods, plan, smsParts, type DayTotal } from './sms-usage.ts';

test('SMS parts as the carrier counts them: 160/153 for plain text, 70/67 once any Khmer is in it', () => {
  assert.equal(smsParts(''), 1);
  assert.equal(smsParts('a'.repeat(160)), 1);
  assert.equal(smsParts('a'.repeat(161)), 2);
  assert.equal(smsParts('a'.repeat(306)), 2);
  assert.equal(smsParts('a'.repeat(307)), 3);
  assert.equal(smsParts('{'.repeat(80)), 1, 'an extension character takes two places');
  assert.equal(smsParts('{'.repeat(81)), 2);
  assert.equal(smsParts('សួស្តី'.padEnd(70, 'ក')), 1);
  assert.equal(smsParts(`Hi Dara ${'ក'.repeat(63)}`), 2, 'one Khmer letter makes all of it UCS-2');
  assert.equal(smsParts('ក'.repeat(135)), 3);
});

const rows: DayTotal[] = [
  { day: '2026-10-05', sim: 1, sms: 10, parts: 20, failed: 0 }, // Mon of an older week, outside the range
  { day: '2026-10-12', sim: 1, sms: 50, parts: 100, failed: 1 }, // Mon
  { day: '2026-10-18', sim: 2, sms: 40, parts: 90, failed: 0 }, // Sun: same week as the 12th
  { day: '2026-10-19', sim: 1, sms: 100, parts: 200, failed: 2 }, // Mon: the next week
  { day: '2026-10-29', sim: 2, sms: 5, parts: 10, failed: 0 }, // Thu of this week
];

test('weeks run Monday to Sunday, newest last, zero-filled, the current one marked partial', () => {
  const w = periods(rows, 'week', '2026-10-29', 3);
  assert.deepEqual(w.map((p) => [p.start, p.end, p.total, p.partial]), [
    ['2026-10-12', '2026-10-18', 90, false],
    ['2026-10-19', '2026-10-25', 100, false],
    ['2026-10-26', '2026-11-01', 5, true],
  ]);
  assert.deepEqual(w[0].bySim, { 1: 50, 2: 40 }, 'SMS by SIM, not parts');
  assert.equal(w[1].failed, 2);
});

test('months are calendar months; the plan is the usual to the busiest, only with enough history', () => {
  const m = periods(rows, 'month', '2026-11-03', 3);
  assert.deepEqual(m.map((p) => [p.start, p.end]), [['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30']]);
  assert.equal(m[1].total, 205); // 10 + 50 + 40 + 100 + 5
  assert.equal(plan(m, 'month'), null, 'one month with SMS is not enough to plan by');

  const m2 = periods([...rows, { day: '2026-09-20', sim: 1, sms: 1, parts: 2, failed: 0 }], 'month', '2026-11-03', 3);
  assert.equal(plan(m2, 'month', '2026-09-20'), null, 'September began before the first total: only partly counted, so left out');
  assert.deepEqual(plan(m2, 'month', '2026-09-01'), { lo: 100, hi: 210, from: 2 }); // (1 + 205) / 2 = 103; 205 rounds to 210

  const w = periods(rows, 'week', '2026-10-29', 5);
  // Complete weeks with SMS: 5 Oct (10), 12 Oct (90), 19 Oct (100); the empty week and this week do not count.
  assert.deepEqual(plan(w, 'week'), { lo: 70, hi: 100, from: 3 }); // (10 + 90 + 100) / 3 = 66.7 → 70
});
