import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScanTime, trackingKey, trimSource } from './values.ts';

test('tracking key upper-cases ASCII a-z only and keeps spaces, zeros and other characters', () => {
  assert.equal(trackingKey('s000000018'), 'S000000018');
  assert.equal(trackingKey('S000000018'), 'S000000018');
  assert.equal(trackingKey('00000000000017'), '00000000000017');
  assert.equal(trackingKey('ab 12'), 'AB 12');
  assert.equal(trackingKey('Ab-12 x'), 'AB-12 X');
  assert.equal(trackingKey('éß ǆ'), 'éß ǆ', 'non-ASCII letters are not changed');
});

test('source values are trimmed of surrounding whitespace and NBSP only', () => {
  assert.equal(trimSource('  S000000018 \t'), 'S000000018');
  assert.equal(trimSource(' AB  12 '), 'AB  12');
});

test('a valid scan time is read as Asia/Phnom_Penh and keeps its local date', () => {
  assert.deepEqual(parseScanTime('2026-10-10 07:15:00'), { utc: '2026-10-10T00:15:00.000Z', date: '2026-10-10' });
  assert.deepEqual(parseScanTime('2026-10-10 03:00:00'), { utc: '2026-10-09T20:00:00.000Z', date: '2026-10-10' });
  assert.deepEqual(parseScanTime('2028-02-29 12:00:00'), { utc: '2028-02-29T05:00:00.000Z', date: '2028-02-29' });
});

test('anything that is not a real YYYY-MM-DD HH:MM:SS is unreadable', () => {
  for (const raw of [
    '2026-02-30 10:00:00', // no such date
    '2026-10-10 25:00:00', // no such hour
    '2026-10-10 07:60:00',
    '2027-02-29 12:00:00',
    '10/10/2026 07:00',
    '2026-10-10T07:15:00',
    '2026-10-10 07:15',
    ' 2026-10-10 07:15:00',
    '2026-10-10 07:15:00 ',
    '46305.3', // a numeric spreadsheet date serial
    '',
    null,
    undefined,
  ]) {
    assert.equal(parseScanTime(raw), null, String(raw));
  }
});
