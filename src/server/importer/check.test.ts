import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../db/paths.ts';
import { checkFile, checkRows, classify, isShopeeOutlet, readRows, scanDates, type FileCheck, type StaffDecision } from './check.ts';

// Expected values: docs/import-rules.md, "Test fixtures".
const fixture = (name: string) => fs.readFileSync(path.join(PROJECT_ROOT, 'test/fixtures', name));
const none = () => ({ conflict: new Map<string, StaffDecision>(), spelling: new Map<string, StaffDecision>(), leftOut: new Set<string>() });
const keysIn = (check: FileCheck, state: string, existing = new Set<string>()) =>
  classify(check.parcels, existing, none(), { kind: 'single_scan_date' })
    .parcels.filter((p) => p.state === state)
    .map((p) => p.key)
    .sort();

for (const [file, format] of [
  ['scan-record-mixed.csv', 'csv'],
  ['scan-record-mixed.xlsx', 'xlsx'],
  ['scan-record-mixed-xlsx-named.xls', 'xlsx'],
  ['scan-record-mixed-biff.xls', 'xls'],
  ['headers-case-and-spaces.xlsx', 'xlsx'],
] as const) {
  test(`${file}: the expected review, read from the bytes as ${format}`, () => {
    const check = checkFile(fixture(file));
    assert.equal(check.format, format);
    assert.deepEqual(
      { total: check.rowsTotal, shopee: check.rowsShopee, excluded: check.rowsExcluded, excludedCodes: check.excludedCodes, unique: check.parcels.length },
      { total: 28, shopee: 18, excluded: 10, excludedCodes: 10, unique: 10 },
    );
    assert.equal(check.rowsShopee - check.parcels.length, 8, 'repeat rows collapsed');
    const { counts } = classify(check.parcels, new Set(), none(), { kind: 'single_scan_date' });
    assert.deepEqual(counts, { db_duplicate: 0, left_out: 0, blocked: 3, ready: 7 });
    assert.deepEqual(keysIn(check, 'blocked'), ['10000000000014', '10000000000015', 'S000000018']);
    assert.ok(keysIn(check, 'ready').includes('10000000000016'), 'case and spacing in a name, or 855-0 in a phone, are not conflicts');
    const zeros = check.parcels.find((p) => p.key === '00000000000017')!;
    assert.deepEqual(zeros.spellings, ['00000000000017'], 'leading zeros kept');
    assert.deepEqual(check.parcels.find((p) => p.key === 'S000000018')!.spellings, ['S000000018', 's000000018']);
    assert.ok(check.parcels.some((p) => p.key === '10000000000002'), 'a Shopee parcel stays one although an excluded row reuses its code');
  });
}

test('header problems: nothing is imported, and the message names the column', () => {
  for (const ext of ['csv', 'xlsx']) {
    assert.throws(() => checkFile(fixture(`headers-no-send-outlet.${ext}`)), { code: 'no_send_outlet', message: /no Send Outlet column/ });
    assert.throws(() => checkFile(fixture(`headers-two-send-outlet.${ext}`)), { code: 'no_send_outlet' });
    assert.throws(() => checkFile(fixture(`headers-no-scan-order-number.${ext}`)), { code: 'missing_column', message: /"scan order number"/ });
  }
  assert.throws(() => checkRows([['Send Outlet', 'scan order number', 'Scan Order Number', 'consignee name', 'consignee mobile', 'scan time']]), {
    code: 'duplicate_column',
  });
  assert.throws(() => readRows(new Uint8Array()), { code: 'empty' });
});

test('outlet rule send-outlet-shopee-shpe/v1: exact after trimming and lower-casing', () => {
  for (const v of ['Shopee SHPE', ' shopee shpe ', 'SHOPEE SHPE', ' Shopee SHPE ']) assert.equal(isShopeeOutlet(v), true, v);
  for (const v of ['Other Outlet', '', undefined, 'Shopee', 'Shopee SHPE Extra', 'Shopee  SHPE']) assert.equal(isShopeeOutlet(v), false, String(v));
});

test('scan-record-two-days: several scan dates need a choice; only one date leaves the rest out', () => {
  for (const ext of ['csv', 'xlsx']) {
    const check = checkFile(fixture(`scan-record-two-days.${ext}`));
    assert.deepEqual([check.rowsTotal, check.rowsShopee, check.parcels.length], [5, 5, 4]);
    assert.deepEqual(scanDates(check.parcels), [
      { date: '2026-10-09', parcels: 1 },
      { date: '2026-10-10', parcels: 3 },
    ]);
    const undecided = classify(check.parcels, new Set(), none(), null);
    assert.equal(undecided.dateChoiceNeeded, true);
    assert.deepEqual(classify(check.parcels, new Set(), none(), { kind: 'all_on_batch_date' }).counts, { db_duplicate: 0, left_out: 0, blocked: 0, ready: 4 });
    const only = classify(check.parcels, new Set(), none(), { kind: 'only_scan_date', date: '2026-10-10' });
    assert.deepEqual(only.counts, { db_duplicate: 0, left_out: 1, blocked: 0, ready: 3 });
    assert.equal(only.parcels.find((p) => p.state === 'left_out')!.key, '10000000000003');
  }
});

test('staff decisions unblock parcels; leaving one out counts it as left out; stored keys are database duplicates', () => {
  const check = checkFile(fixture('scan-record-mixed.csv'));
  const d = none();
  d.conflict.set('10000000000014', { resolution: 'chosen', chosen: { name: 'x', phone: '012345678' } });
  d.conflict.set('10000000000015', { resolution: 'left_out' });
  d.spelling.set('S000000018', { resolution: 'chosen', chosen: { code: 'S000000018' } });
  assert.deepEqual(classify(check.parcels, new Set(), d, { kind: 'single_scan_date' }).counts, { db_duplicate: 0, left_out: 1, blocked: 0, ready: 9 });
  // A stored key wins over every other state, including a code stored with other letter case (same key).
  const stored = new Set(['10000000000001', 'S000000018']);
  const { counts } = classify(check.parcels, stored, none(), { kind: 'single_scan_date' });
  assert.deepEqual(counts, { db_duplicate: 2, left_out: 0, blocked: 2, ready: 6 });
  for (const c of [counts]) assert.equal(c.db_duplicate + c.left_out + c.blocked + c.ready, check.parcels.length);
});

test('scan events keep every row: source text, parsed UTC, date; unreadable times are kept as text without a date', () => {
  const header = ['scan order number', 'Send Outlet', 'consignee name', 'consignee mobile', 'scan time', 'scanTypeDesc', 'scan site', 'Upload Time'];
  const check = checkRows([
    header,
    ['A1', 'Shopee SHPE', 'Kim', '012345678', '2026-10-10 07:15:00', 'arrived', 'Site 1', '2026-10-10 08:00:00'],
    ['A1', 'Shopee SHPE', 'Kim', '012345678', '2026-10-10 09:00:00', 'Delivery', 'Site 1', '2026-10-10 09:05:00'],
    ['B2', 'Shopee SHPE', 'Dara', '012345679', '2026-02-30 10:00:00', 'Delivery', 'Site 1', ''],
    ['', 'Shopee SHPE', 'No Code', '012345670', '2026-10-10 10:00:00', 'Delivery', 'Site 1', ''],
  ]);
  assert.deepEqual([check.rowsTotal, check.rowsShopee, check.rowsExcluded], [4, 3, 1], 'a Shopee row without a code is counted as excluded');
  const a = check.parcels.find((p) => p.key === 'A1')!;
  assert.deepEqual(
    a.rows.map((r) => [r.sourceRow, r.scanTypeRaw, r.scanTimeRaw, r.scanTimeUtc, r.scanDate, r.scanSiteRaw, r.uploadTimeRaw]),
    [
      [2, 'arrived', '2026-10-10 07:15:00', '2026-10-10T00:15:00.000Z', '2026-10-10', 'Site 1', '2026-10-10 08:00:00'],
      [3, 'Delivery', '2026-10-10 09:00:00', '2026-10-10T02:00:00.000Z', '2026-10-10', 'Site 1', '2026-10-10 09:05:00'],
    ],
  );
  const b = check.parcels.find((p) => p.key === 'B2')!;
  assert.deepEqual([b.scanDate, b.unparseableRows, b.rows[0].scanTimeRaw, b.rows[0].scanTimeUtc], [null, 1, '2026-02-30 10:00:00', null]);
  // Unreadable scan times form their own group, so the file has two "dates" and needs the date choice.
  assert.deepEqual(scanDates(check.parcels), [
    { date: '2026-10-10', parcels: 1 },
    { date: null, parcels: 1 },
  ]);
});
