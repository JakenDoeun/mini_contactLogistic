import test from 'node:test';
import assert from 'node:assert/strict';
import { writeAudit } from './audit.ts';
import type { Db } from './connection.ts';
import { decideReviewItem } from './review-items.ts';
import { createTestDb } from './test-db.ts';

const AT = '2026-10-14T01:00:00.000Z';

function addCheckedImport(db: Db) {
  return Number(
    db
      .prepare(
        `INSERT INTO imports (source, original_filename, stored_path, sha256, size_bytes, status, rules, headers_found, scan_dates,
           rows_total, rows_shopee, rows_excluded, excluded_codes, rows_collapsed, parcels_unique, db_duplicates, left_out, blocked,
           ready, checked_at)
         VALUES ('manual', 'scan-record-mixed.xlsx', '/tmp/x', ?, 1, 'checked', '[]', '{}', '{}', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)`,
      )
      .run(String(Math.random()), AT).lastInsertRowid,
  );
}
const addItem = (db: Db, importId: number, kind = 'recipient_conflict', blocking = 1) =>
  Number(
    db
      .prepare("INSERT INTO import_review_items (import_id, tracking_key, kind, blocking, detail, created_at) VALUES (?, 'S000000018', ?, ?, '{}', ?)")
      .run(importId, kind, blocking, AT).lastInsertRowid,
  );
const itemRow = (db: Db, id: number) =>
  db.prepare('SELECT resolution, chosen, resolved_by, resolved_at FROM import_review_items WHERE id = ?').get(id);
const auditRows = (db: Db) =>
  db.prepare("SELECT user_id, entity, entity_ids, outcome, detail FROM audit_log WHERE action = 'import.review_decided' ORDER BY id").all() as {
    user_id: number | null; entity: string; entity_ids: string; outcome: string; detail: string;
  }[];

test('staff may revise a review decision while the import is checked; each change is audited safely', async (t) => {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  const imp = addCheckedImport(db);
  const item = addItem(db, imp);
  const pick = { recipient_name: 'Test Customer T', phone_raw: '012 345 678' };

  decideReviewItem(db, item, { resolution: 'chosen', chosen: pick }, null, '2026-10-14T01:01:00.000Z');
  assert.deepEqual(itemRow(db, item), { resolution: 'chosen', chosen: JSON.stringify(pick), resolved_by: null, resolved_at: '2026-10-14T01:01:00.000Z' });
  decideReviewItem(db, item, { resolution: 'left_out' }, null, '2026-10-14T01:02:00.000Z');
  assert.deepEqual(itemRow(db, item), { resolution: 'left_out', chosen: null, resolved_by: null, resolved_at: '2026-10-14T01:02:00.000Z' });
  const other = { recipient_name: 'Test Customer U', phone_raw: '+855 77 123 456' };
  decideReviewItem(db, item, { resolution: 'chosen', chosen: other }, null, '2026-10-14T01:03:00.000Z');
  assert.equal((itemRow(db, item) as { chosen: string }).chosen, JSON.stringify(other));

  const rows = auditRows(db);
  assert.deepEqual(rows.map((r) => JSON.parse(r.detail)), [
    { item_kind: 'recipient_conflict', resolution_from: null, resolution_to: 'chosen' },
    { item_kind: 'recipient_conflict', resolution_from: 'chosen', resolution_to: 'left_out' },
    { item_kind: 'recipient_conflict', resolution_from: 'left_out', resolution_to: 'chosen' },
  ]);
  assert.ok(rows.every((r) => r.entity === 'import_review_item' && r.outcome === 'ok'));
  assert.deepEqual(JSON.parse(rows[0].entity_ids), { import: [imp], review_item: [item] });
  // Never the chosen name or phone, in any form.
  const everything = JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
  for (const secret of ['Test Customer', '012 345 678', '012345678', '77 123 456', '77123456']) assert.equal(everything.includes(secret), false, secret);
});

test('Confirm, cancel or failure freezes the decisions; a refused change writes no audit entry', async (t) => {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  const frozen = (status: string, extra: string) => {
    const imp = addCheckedImport(db);
    const item = addItem(db, imp, 'db_duplicate', 0);
    decideReviewItem(db, item, { resolution: 'left_out' }, null);
    db.prepare(`UPDATE imports SET status = ?${extra} WHERE id = ?`).run(status, imp);
    return item;
  };
  const items = [
    frozen('imported', ", confirmed_at = '2026-10-14T02:00:00.000Z', arrival_batch_date = '2026-10-14', date_choice = 'single_scan_date'"),
    frozen('cancelled', ''),
    frozen('failed', ", error_code = 'confirm_failed'"),
  ];
  const auditBefore = auditRows(db).length;
  for (const item of items) {
    const before = itemRow(db, item);
    assert.throws(() => decideReviewItem(db, item, { resolution: 'chosen', chosen: { tracking_code: 'S000000018' } }, null), /is frozen/);
    // The trigger holds even if the service check is bypassed.
    assert.throws(() => db.prepare("UPDATE import_review_items SET resolution = 'chosen', chosen = '{}' WHERE id = ?").run(item), /read-only once/);
    assert.deepEqual(itemRow(db, item), before);
  }
  assert.equal(auditRows(db).length, auditBefore);
  assert.throws(() => decideReviewItem(db, 999_999, { resolution: 'left_out' }, null), /does not exist/);
});

test('closed-set audit keys refuse free text', async (t) => {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  const audit = (detail: Record<string, unknown>) =>
    writeAudit(db, { action: 'import.review_decided', entity: 'import_review_item', entityIds: [1], outcome: 'ok', detail });
  audit({ item_kind: 'code_spelling', resolution_from: null, resolution_to: 'left_out' });
  assert.throws(() => audit({ item_kind: 'Test Customer T' }), /outside its allowed set/);
  assert.throws(() => audit({ resolution_to: null }), /outside its allowed set/);
  assert.throws(() => audit({ resolution_from: 'chosen: Test Customer T' }), /outside its allowed set/);
});
