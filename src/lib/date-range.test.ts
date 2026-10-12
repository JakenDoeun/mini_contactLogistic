import test from 'node:test';
import assert from 'node:assert/strict';
import { inDateRange, isAnyDate } from './date-range.ts';

const now = new Date(2026, 9, 12, 15, 0); // 12 Oct, 3 pm local
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();

test('presets use whole local days', () => {
  assert.ok(inDateRange(at(12, 0), { preset: 'today' }, now));
  assert.ok(!inDateRange(at(11, 23), { preset: 'today' }, now));
  assert.ok(inDateRange(at(11, 23), { preset: 'yesterday' }, now));
  assert.ok(inDateRange(at(6), { preset: '7d' }, now));
  assert.ok(!inDateRange(at(5), { preset: '7d' }, now));
  assert.ok(inDateRange(at(1), { preset: 'any' }, now));
});

test('custom range includes both end days, open ends and reversed dates', () => {
  const r = { preset: 'custom' as const, from: '2026-10-10', to: '2026-10-11' };
  assert.ok(inDateRange(at(10, 0), r, now));
  assert.ok(inDateRange(at(11, 23), r, now));
  assert.ok(!inDateRange(at(12, 0), r, now));
  assert.ok(inDateRange(at(11), { ...r, from: '2026-10-11', to: '2026-10-10' }, now));
  assert.ok(inDateRange(at(30), { preset: 'custom', from: '2026-10-11' }, now));
  assert.ok(isAnyDate({ preset: 'custom' }));
  assert.ok(!isAnyDate({ preset: 'custom', to: '2026-10-11' }));
});
