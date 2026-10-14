import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_PARCELS } from '../../lib/mock/sample-parcels.ts';
import { writeAudit } from './audit.ts';
import type { Db } from './connection.ts';
import { editParcelPhone, insertNewParcels } from './parcels.ts';
import { seedDemoData } from './seed.ts';
import { createTestDb } from './test-db.ts';

const AT = '2026-10-12T01:00:00.000Z';

function addImport(db: Db, fields: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    source: 'manual', original_filename: 'scan-record-mixed.xlsx', stored_path: '/tmp/x', sha256: String(Math.random()), size_bytes: 1,
    status: 'checked', rules: '[]', headers_found: '{}', scan_dates: '{}', rows_total: 0, rows_shopee: 0, rows_excluded: 0,
    excluded_codes: 0, rows_collapsed: 0, parcels_unique: 0, db_duplicates: 0, left_out: 0, blocked: 0, ready: 0, checked_at: AT, ...fields,
  };
  const cols = Object.keys(row);
  return Number(db.prepare(`INSERT INTO imports (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row).lastInsertRowid);
}

const parcelRow = (db: Db, key: string) =>
  db.prepare('SELECT * FROM parcels WHERE tracking_key = ?').get(key) as Record<string, unknown>;
const phoneHistory = (db: Db, id: unknown) => db.prepare('SELECT * FROM parcel_phone_changes WHERE parcel_id = ? ORDER BY id').all(id);

test('re-imports never overwrite a parcel, its staff-edited phone or its phone history', async (t) => {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  const first = addImport(db);
  const { inserted } = insertNewParcels(db, first, [
    { trackingCode: ' S000000018 ', recipientName: 'Test Customer T', phoneRaw: '855123456718', arrivalDate: '2026-10-10' },
  ]);
  assert.equal(inserted.length, 1);
  editParcelPhone(db, inserted[0], '012 999 888', null);
  const before = parcelRow(db, 'S000000018');
  const historyBefore = phoneHistory(db, before.id);
  assert.equal(before.tracking_code, 'S000000018');
  assert.equal(before.import_phone_raw, '855123456718');
  assert.equal(before.phone_raw, '012 999 888');
  assert.equal(before.phone_normalized, '012999888');
  assert.equal(before.phone_edited, 1);
  assert.equal(historyBefore.length, 1);

  // A later import and a partial re-review of the same file carry the code (other case) with another phone and name.
  const second = addImport(db);
  const rerun = addImport(db, { rerun_of_import_id: first });
  for (const importId of [second, rerun]) {
    const result = insertNewParcels(db, importId, [
      { trackingCode: 's000000018', recipientName: 'Someone Else', phoneRaw: '855111222333', arrivalDate: '2026-10-11' },
      { trackingCode: `NEW${importId}`, recipientName: 'Test Customer U', phoneRaw: '', arrivalDate: '2026-10-11' },
    ]);
    assert.deepEqual(result.skippedKeys, ['S000000018']);
    assert.equal(result.inserted.length, 1);
  }
  assert.deepEqual(parcelRow(db, 'S000000018'), before);
  assert.deepEqual(phoneHistory(db, before.id), historyBefore);
  const blank = parcelRow(db, `NEW${second}`);
  assert.equal(blank.phone_raw, null);
  assert.equal(blank.phone_normalized, null);
});

test('audit log entries never hold names, phone numbers or message text', async (t) => {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  seedDemoData(db);
  const id = (db.prepare("SELECT id FROM parcels WHERE tracking_code = 'CB4810276635'").get() as { id: number }).id;
  editParcelPhone(db, id, '+855 77 123 456', null);
  editParcelPhone(db, id, 'not a phone', null);

  assert.throws(() => writeAudit(db, { action: 'parcel.phone_edited', entity: 'parcel', entityIds: [id], outcome: 'ok', detail: { new_phone: '012345678' } }), /not allowed/);
  assert.throws(() => writeAudit(db, { action: 'import.checked', entity: 'import', entityIds: [1], outcome: 'ok', detail: { file_name: 'list 012 345 678.xlsx' } }), /phone number/);
  assert.throws(() => writeAudit(db, { action: 'import.checked', entity: 'import', entityIds: [1], outcome: 'ok', detail: { error_code: '+855 12 345 678' } }), /phone number/);
  assert.throws(() => writeAudit(db, { action: 'import.checked', entity: 'import', entityIds: ['Sokha Chan' as unknown as number], outcome: 'ok' }), /record IDs/);
  writeAudit(db, { action: 'import.checked', entity: 'import', entityIds: [1], outcome: 'ok', detail: { file_name: 'Scan_record 20261010.xls', sha256: 'ab'.repeat(32) } });

  const rows = db.prepare('SELECT action, entity_ids, detail FROM audit_log').all() as { action: string; entity_ids: string; detail: string }[];
  assert.ok(rows.length >= 5);
  const names = SAMPLE_PARCELS.map(([, name]) => name);
  const phoneDigits = new Set([...SAMPLE_PARCELS.map(([, , phone]) => phone.replace(/\D/g, '')), '85577123456'].filter(Boolean));
  const phoneShaped = /(?:\+?855|(?<!\d)0)[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{3,4}(?!\d)/;
  for (const row of rows) {
    const strings: string[] = [];
    const ids: unknown[] = [];
    const walk = (v: unknown, into: unknown[]): void => {
      if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, into));
      else into.push(v);
    };
    walk(JSON.parse(row.entity_ids), ids);
    walk(JSON.parse(row.detail), strings);
    assert.ok(ids.every((n) => Number.isInteger(n)), `${row.action}: entity_ids are record IDs only`);
    for (const s of strings.filter((x): x is string => typeof x === 'string')) {
      for (const name of names) assert.equal(s.includes(name), false, `${row.action} contains a name`);
      assert.equal(phoneShaped.test(s), false, `${row.action} contains a phone-shaped value`);
      assert.equal(phoneDigits.has(s.replace(/\D/g, '')), false, `${row.action} contains a phone number`);
    }
  }
  const edits = rows.filter((r) => r.action === 'parcel.phone_edited');
  assert.deepEqual(edits.map((r) => [r.entity_ids, r.detail]), [
    [`[${id}]`, '{"phone_valid":true}'],
    [`[${id}]`, '{"phone_valid":false}'],
  ]);
  // The numbers themselves are kept only in the phone history.
  assert.deepEqual(phoneHistory(db, id).map((r) => (r as { new_raw: string }).new_raw), ['+855 77 123 456', 'not a phone']);
});

test('audit sha256 is checked by its exact format, not by the phone pattern', async (t) => {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  const audit = (sha256: unknown) =>
    writeAudit(db, { action: 'import.checked', entity: 'import', entityIds: [1], outcome: 'ok', detail: { sha256 } });
  // A real SHA-256 that the phone pattern used to refuse (review finding H1, 2026-10-14).
  const reproduced = 'a68b412c4282555f15546cf6e1fc42893b7e07f271557ceb021821098dd66c1b';
  assert.match(reproduced, /(?:\+?855|(?<!\d)0)[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{3,4}(?!\d)/, 'still phone-shaped');
  audit(reproduced);
  for (const bad of [reproduced.toUpperCase(), reproduced.slice(1), `${reproduced}0`, '012 345 678', 42, null]) {
    assert.throws(() => audit(bad), /64 lower-case hex/, String(bad));
  }
  // Phone-shaped text under any other key is still refused.
  assert.throws(() => writeAudit(db, { action: 'import.checked', entity: 'import', entityIds: [1], outcome: 'ok', detail: { file_name: reproduced } }), /phone number/);
});

test('demo seed: fictional sample parcels once, and never into a database with real imports', async (t) => {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  const now = Date.parse('2026-10-12T05:00:00.000Z');
  const result = seedDemoData(db, now);
  assert.deepEqual(result, { seeded: true, imports: 3, parcels: SAMPLE_PARCELS.length });
  assert.deepEqual(seedDemoData(db, now), { seeded: false, reason: 'demo data already present' });
  const imports = db.prepare('SELECT source, status, arrival_batch_date, parcels_added FROM imports ORDER BY arrival_batch_date').all();
  assert.deepEqual(imports, [
    { source: 'seed', status: 'imported', arrival_batch_date: '2026-10-10', parcels_added: 3 },
    { source: 'seed', status: 'imported', arrival_batch_date: '2026-10-11', parcels_added: 5 },
    { source: 'seed', status: 'imported', arrival_batch_date: '2026-10-12', parcels_added: 11 },
  ]);

  const other = await createTestDb();
  t.after(other.cleanup);
  addImport(other.db, { source: 'manual' });
  assert.throws(() => seedDemoData(other.db, now), /non-seed imports/);
  assert.equal((other.db.prepare('SELECT count(*) AS n FROM parcels').get() as { n: number }).n, 0);
});
