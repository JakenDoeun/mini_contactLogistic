import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreview, failedRecord, mockRows, parcelsFromPreview, recordFromPreview, summarizeDay, validateFile, type FileMeta } from './import-logic.ts';
import { workList } from './dashboard-logic.ts';
import { addNewParcels, phoneGroup, type Parcel } from './parcel-logic.ts';

const meta = (fileName: string, fingerprint = fileName): FileMeta => ({
  fileName,
  fingerprint,
  size: 1000,
  modifiedAt: '2026-10-10T08:00:00.000Z',
  source: 'manual',
});

test('validateFile accepts exports and rejects other files', () => {
  assert.equal(validateFile({ name: 'Arrivals.XLSX', size: 100 }), null);
  assert.equal(validateFile({ name: 'a.csv', size: 100 }), null);
  assert.match(validateFile({ name: 'a.pdf', size: 100 })!, /not an Excel or CSV/);
  assert.match(validateFile({ name: 'a.csv', size: 0 })!, /empty/);
  assert.match(validateFile({ name: 'a.csv', size: 11 * 1024 * 1024 })!, /10 MB/);
});

test('every row is new or skipped, and a re-import adds nothing', () => {
  const first = buildPreview(meta('arrivals.xlsx'), new Set(), []);
  assert.equal(first.newCodes.length + first.duplicateCodes.length, mockRows('arrivals.xlsx').length);
  const imported = recordFromPreview(first, '2026-10-10T09:00:00.000Z');

  const second = buildPreview(meta('arrivals.xlsx'), new Set(first.newCodes), [imported]);
  assert.equal(second.newCodes.length, 0);
  assert.equal(second.duplicateCodes.length, first.totalRows);
  assert.ok(second.rows.every((r) => r.existing));
});

test('a file is recognised by its fingerprint, not its name, and failed imports do not count', () => {
  const done = recordFromPreview(buildPreview(meta('a.xlsx', 'abc'), new Set(), []), '2026-10-10T09:00:00.000Z');
  assert.equal(buildPreview(meta('renamed.xlsx', 'abc'), new Set(), [done]).duplicateOf, done);
  assert.equal(buildPreview(meta('a.xlsx', 'other'), new Set(), [done]).duplicateOf, null);
  const failed = { ...failedRecord('a.xlsx', 'manual', '2026-10-10T09:00:00.000Z', 'x'), fingerprint: 'abc' };
  assert.equal(buildPreview(meta('a.xlsx', 'abc'), new Set(), [failed]).duplicateOf, null);
});

test('summarizeDay counts only imported files from that day', () => {
  const day = new Date('2026-10-10T12:00:00');
  const ok = recordFromPreview(buildPreview(meta('a.xlsx'), new Set(), []), new Date('2026-10-10T08:00:00').toISOString());
  const old = recordFromPreview(buildPreview(meta('b.xlsx'), new Set(), []), new Date('2026-10-09T08:00:00').toISOString());
  const failed = failedRecord('c.xlsx', 'folder', new Date('2026-10-10T10:00:00').toISOString(), 'x');
  assert.deepEqual(summarizeDay([old, failed, ok], day), { files: 1, newRecords: ok.newRecords, duplicates: ok.duplicateCodes.length });
});

test('a confirmed import lands in the parcel records and shows on the work list, grouped only within its own batch', () => {
  const existing: Parcel[] = [{ code: 'OLD1', recipient: 'Sokha', phone: '012 345 678', importedAt: '2026-10-09T08:00:00Z', sourceFile: 'old.xlsx' }];
  const rows = [
    { tracking: 'NEW1', recipient: 'Sokha Chan', phone: '+855 12 345 678' },
    { tracking: 'NEW2', recipient: 'Dara', phone: '' },
    { tracking: 'NEW1', recipient: 'Sokha Chan', phone: '012 345 678' }, // repeated inside the file
  ];
  const preview = buildPreview(meta('arrivals.xlsx'), new Set(existing.map((p) => p.code)), [], rows);
  assert.deepEqual([preview.newCodes, preview.duplicateCodes], [['NEW1', 'NEW2'], ['NEW1']]);

  const parcels = addNewParcels(existing, parcelsFromPreview(preview, '2026-10-10T09:00:00Z'));
  assert.deepEqual(parcels.map((p) => [p.code, p.sourceFile]), [['OLD1', 'old.xlsx'], ['NEW1', 'arrivals.xlsx'], ['NEW2', 'arrivals.xlsx']]);
  // Same phone, different arrival day: never one group, never one SMS.
  assert.deepEqual(phoneGroup(parcels[1], parcels).map((p) => p.code), ['NEW1']);
  const w = workList(parcels, []);
  assert.deepEqual(w.toMessage.map((g) => g.codes), [['NEW1'], ['OLD1']]);
  assert.deepEqual(w.noPhone.map((p) => p.code), ['NEW2']);
});

test('re-importing the same file adds nothing and keeps phones staff corrected', () => {
  const first = buildPreview(meta('arrivals.xlsx'), new Set(), []);
  let parcels = addNewParcels([], parcelsFromPreview(first, '2026-10-10T09:00:00Z'));
  parcels = parcels.map((p, i) => (i === 0 ? { ...p, phone: '099 111 222' } : p)); // staff fixed a number
  const again = buildPreview(meta('arrivals.xlsx'), new Set(parcels.map((p) => p.code)), [recordFromPreview(first, '2026-10-10T09:00:00Z')]);
  assert.equal(again.newRows.length, 0);
  assert.ok(again.duplicateOf);
  const after = addNewParcels(parcels, parcelsFromPreview(again, '2026-10-11T09:00:00Z'));
  assert.deepEqual(after, parcels);
});
