import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/connection.ts';
import { editParcelPhone, insertNewParcels } from '../db/parcels.ts';
import { PROJECT_ROOT } from '../db/paths.ts';
import { purgeExpired } from '../db/retention.ts';
import { decideReviewItem } from '../db/review-items.ts';
import { createTestDb } from '../db/test-db.ts';
import { cancelImport, checkImport, confirmImport, DUPLICATE_FILE_KEY, listImports, reviewImport, validDecision } from './store.ts';

const fixture = (name: string) => fs.readFileSync(path.join(PROJECT_ROOT, 'test/fixtures', name));
// 10:00 in Phnom Penh on 10 Oct 2026, the fixtures' scan date.
const ON_SCAN_DAY = new Date('2026-10-10T03:00:00Z');
const csv = (lines: string[][]) => new TextEncoder().encode(lines.map((l) => l.join(',')).join('\n'));
const HEADER = ['scan order number', 'Send Outlet', 'consignee name', 'consignee mobile', 'scan time'];

async function setup(t: test.TestContext) {
  const { db, dir, cleanup } = await createTestDb();
  t.after(cleanup);
  return { db, dataDir: dir };
}
const count = (db: Db, sql: string, ...args: unknown[]) => (db.prepare(sql).pluck().get(...args) as number) ?? 0;
const item = (db: Db, importId: number, key: string, kind: string) =>
  db.prepare('SELECT id FROM import_review_items WHERE import_id = ? AND tracking_key = ? AND kind = ?').pluck().get(importId, key, kind) as number;
const confirm = (db: Db, dataDir: string, id: number, extra: Partial<Parameters<typeof confirmImport>[3]> = {}) =>
  confirmImport(db, dataDir, id, { arrivalBatchDate: '2026-10-10', dateChoice: { kind: 'single_scan_date' }, batchDateChosen: false, userId: null, now: ON_SCAN_DAY, ...extra });

test('mixed file: checked and saved for review; Confirm waits for the 3 decisions, then adds parcels and scan events', async (t) => {
  const { db, dataDir } = await setup(t);
  const r = checkImport(db, dataDir, { bytes: fixture('scan-record-mixed-xlsx-named.xls'), fileName: 'C:\\fakepath\\Scan_record.xls', source: 'manual', userId: null, now: ON_SCAN_DAY });
  assert.equal(r.status, 'checked');
  const stored = db.prepare('SELECT original_filename, stored_path, file_format, rows_total, rows_shopee, parcels_unique, blocked, ready FROM imports WHERE id = ?').get(r.importId);
  assert.deepEqual({ ...(stored as object), stored_path: undefined }, { original_filename: 'Scan_record.xls', stored_path: undefined, file_format: 'xlsx', rows_total: 28, rows_shopee: 18, parcels_unique: 10, blocked: 3, ready: 7 });
  const file = path.join(dataDir, (stored as { stored_path: string }).stored_path);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'the original is owner-only');
  assert.equal(count(db, 'SELECT count(*) FROM parcels'), 0, 'a check writes no parcels');

  const review = reviewImport(db, dataDir, r.importId, { kind: 'single_scan_date' }, ON_SCAN_DAY)!;
  assert.deepEqual(review.counts, { unique: 10, db_duplicate: 0, left_out: 0, blocked: 3, ready: 7 });
  assert.equal(review.parcels.length, 10, 'the review lists every parcel');
  assert.equal(review.parcels.filter((p) => p.state === 'blocked').length, 3, 'each with the state it is counted under');
  assert.deepEqual(review.items.filter((i) => i.blocking).map((i) => [i.key, i.kind]).sort(), [
    ['10000000000014', 'recipient_conflict'], ['10000000000015', 'recipient_conflict'], ['S000000018', 'code_spelling'],
  ]);
  assert.equal(review.canConfirm, false);
  const refused = confirm(db, dataDir, r.importId);
  assert.deepEqual(refused, { ok: false, reason: 'refused', messages: ['3 parcel(s) need a decision first.'] });

  // A decision must pick values the file offers.
  const phoneConflict = item(db, r.importId, '10000000000014', 'recipient_conflict');
  const offered = review.items.find((i) => i.id === phoneConflict)!.detail as { names: string[]; phones: string[] };
  assert.match(validDecision(db, dataDir, phoneConflict, { resolution: 'chosen', chosen: { name: offered.names[0], phone: '099999999' } })!, /from those in the file/);
  decideReviewItem(db, phoneConflict, { resolution: 'chosen', chosen: { name: offered.names[0], phone: offered.phones[1] } }, null);
  decideReviewItem(db, item(db, r.importId, '10000000000015', 'recipient_conflict'), { resolution: 'left_out' }, null);
  decideReviewItem(db, item(db, r.importId, 'S000000018', 'code_spelling'), { resolution: 'chosen', chosen: { code: 's000000018' } }, null);

  const done = confirm(db, dataDir, r.importId);
  assert.deepEqual(done, { ok: true, added: 9 });
  const imp = db.prepare('SELECT status, ready, parcels_added, left_out, blocked, date_choice, arrival_batch_date, arrival_date_changed FROM imports WHERE id = ?').get(r.importId);
  assert.deepEqual(imp, { status: 'imported', ready: 9, parcels_added: 9, left_out: 1, blocked: 0, date_choice: 'single_scan_date', arrival_batch_date: '2026-10-10', arrival_date_changed: 0 });
  assert.equal(count(db, "SELECT count(*) FROM parcels WHERE arrival_date = '2026-10-10'"), 9);
  assert.equal(count(db, "SELECT count(*) FROM parcels WHERE tracking_code = 's000000018'"), 1, 'the chosen spelling is stored');
  assert.equal(count(db, "SELECT count(*) FROM parcels WHERE tracking_code = '00000000000017'"), 1, 'leading zeros kept');
  assert.equal(db.prepare("SELECT phone_raw FROM parcels WHERE tracking_key = '10000000000014'").pluck().get(), offered.phones[1], 'the chosen phone');
  assert.equal(count(db, "SELECT count(*) FROM parcels WHERE tracking_key = '10000000000015'"), 0, 'left out');
  assert.equal(count(db, 'SELECT count(*) FROM parcel_scan_events WHERE import_id = ?', r.importId), 16, '18 Shopee rows minus the 2 of the left-out parcel');
  assert.equal(count(db, "SELECT count(*) FROM parcel_scan_events e JOIN parcels p ON p.id = e.parcel_id WHERE p.tracking_key = '10000000000005'"), 3);

  // A second Confirm (double click, second tab) adds nothing; decisions are frozen.
  assert.deepEqual(confirm(db, dataDir, r.importId), { ok: false, reason: 'refused', messages: ['This import is imported.'] });
  assert.throws(() => decideReviewItem(db, phoneConflict, { resolution: 'left_out' }, null), /frozen/);
  assert.equal(count(db, 'SELECT count(*) FROM parcels'), 9);
  // The audit log carries counts and IDs, never the file's names or phones.
  const audit = (db.prepare("SELECT detail FROM audit_log WHERE action LIKE 'import.%'").pluck().all() as string[]).join(' ');
  for (const secret of [...offered.names, ...offered.phones, 'Scan_record']) assert.equal(audit.includes(secret), false, secret);
  assert.equal(listImports(db)[0] && (listImports(db)[0] as { status: string }).status, 'imported');
});

test('the same file again: a warning by default, refused when Settings say block', async (t) => {
  const { db, dataDir } = await setup(t);
  const bytes = fixture('scan-record-mixed.csv');
  const first = checkImport(db, dataDir, { bytes, fileName: 'a.csv', source: 'manual', userId: null, now: ON_SCAN_DAY });
  for (const key of ['10000000000014', '10000000000015']) decideReviewItem(db, item(db, first.importId, key, 'recipient_conflict'), { resolution: 'left_out' }, null);
  decideReviewItem(db, item(db, first.importId, 'S000000018', 'code_spelling'), { resolution: 'left_out' }, null);
  assert.deepEqual(confirm(db, dataDir, first.importId), { ok: true, added: 7 });

  const again = checkImport(db, dataDir, { bytes, fileName: 'renamed.csv', source: 'manual', userId: null, now: ON_SCAN_DAY });
  assert.equal(again.status, 'checked');
  const review = reviewImport(db, dataDir, again.importId, { kind: 'single_scan_date' }, ON_SCAN_DAY)!;
  assert.equal(review.earlier.length, 1, 'the earlier import is shown');
  assert.equal(review.counts.db_duplicate, 7, 'the parcels already stored are skipped');

  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, '\"block\"', ?)").run(DUPLICATE_FILE_KEY, ON_SCAN_DAY.toISOString());
  const blocked = checkImport(db, dataDir, { bytes, fileName: 'again.csv', source: 'manual', userId: null, now: ON_SCAN_DAY });
  assert.deepEqual([blocked.status, blocked.errorCode], ['failed', 'duplicate_file']);
  assert.match(blocked.message!, /already imported/);
});

test('two scan dates: a choice is required; one date now, the remaining date in a re-review, then the file is a duplicate', async (t) => {
  const { db, dataDir } = await setup(t);
  const bytes = fixture('scan-record-two-days.csv');
  const first = checkImport(db, dataDir, { bytes, fileName: 'two.csv', source: 'manual', userId: null, now: ON_SCAN_DAY });
  const undecided = confirm(db, dataDir, first.importId);
  assert.equal(undecided.ok, false);
  assert.match((undecided as { messages: string[] }).messages.join(' '), /Choose how the scan dates apply/);
  const only10 = { kind: 'only_scan_date' as const, date: '2026-10-10' };
  assert.deepEqual(confirm(db, dataDir, first.importId, { dateChoice: only10, batchDateChosen: true }), { ok: true, added: 3 });
  assert.equal(count(db, "SELECT count(*) FROM import_review_items WHERE import_id = ? AND kind = 'not_chosen_scan_date'", first.importId), 1);

  const rerun = checkImport(db, dataDir, { bytes, fileName: 'two.csv', source: 'manual', userId: null, now: ON_SCAN_DAY });
  const review = reviewImport(db, dataDir, rerun.importId, null, ON_SCAN_DAY)!;
  assert.equal(review.rerunOf, first.importId);
  assert.deepEqual(review.scanDates.map((d) => [d.date, d.importedBefore]), [['2026-10-09', false], ['2026-10-10', true]]);
  const again10 = confirm(db, dataDir, rerun.importId, { dateChoice: only10, batchDateChosen: true });
  assert.equal(again10.ok, false);
  assert.match((again10 as { messages: string[] }).messages.join(' '), /already imported from this file/);
  const allOn = confirm(db, dataDir, rerun.importId, { dateChoice: { kind: 'all_on_batch_date' }, batchDateChosen: true });
  assert.match((allOn as { messages: string[] }).messages.join(' '), /remaining scan dates/);
  assert.deepEqual(confirm(db, dataDir, rerun.importId, { dateChoice: { kind: 'only_scan_date', date: '2026-10-09' }, batchDateChosen: true }), { ok: true, added: 1 });

  const third = checkImport(db, dataDir, { bytes, fileName: 'two.csv', source: 'manual', userId: null, now: ON_SCAN_DAY });
  assert.equal(reviewImport(db, dataDir, third.importId, null, ON_SCAN_DAY)!.rerunOf, null, 'every date imported: an ordinary duplicate');
});

test('a scan date other than today: Confirm waits for an explicit Arrival Batch Date, which lands on every parcel', async (t) => {
  const { db, dataDir } = await setup(t);
  const nextDay = new Date('2026-10-10T17:30:00Z'); // 00:30 on 11 Oct in Phnom Penh
  const r = checkImport(db, dataDir, { bytes: fixture('scan-record-two-days.csv'), fileName: 'f.csv', source: 'manual', userId: null, now: nextDay });
  const all = { kind: 'all_on_batch_date' as const };
  const refused = confirmImport(db, dataDir, r.importId, { arrivalBatchDate: '2026-10-11', dateChoice: all, batchDateChosen: false, userId: null, now: nextDay });
  assert.match((refused as { messages: string[] }).messages.join(' '), /confirm the Arrival Batch Date/);
  const ok = confirmImport(db, dataDir, r.importId, { arrivalBatchDate: '2026-10-08', dateChoice: all, batchDateChosen: true, userId: null, now: nextDay });
  assert.deepEqual(ok, { ok: true, added: 4 });
  assert.equal(count(db, "SELECT count(*) FROM parcels WHERE arrival_date = '2026-10-08'"), 4, 'never the scan date or the import time');
  assert.equal(count(db, 'SELECT arrival_date_changed FROM imports WHERE id = ?', r.importId), 1);
});

test('files that cannot be imported: header problems fail, no Shopee rows is its own status; nothing is written to parcels', async (t) => {
  const { db, dataDir } = await setup(t);
  const bad = checkImport(db, dataDir, { bytes: fixture('headers-no-send-outlet.xlsx'), fileName: 'x.xlsx', source: 'manual', userId: null });
  assert.deepEqual([bad.status, bad.errorCode], ['failed', 'no_send_outlet']);
  const none = checkImport(db, dataDir, { bytes: csv([HEADER, ['A1', 'Other Outlet', 'Kim', '012345678', '2026-10-10 07:00:00']]), fileName: 'n.csv', source: 'manual', userId: null });
  assert.equal(none.status, 'no_eligible_rows');
  assert.deepEqual(confirm(db, dataDir, none.importId), { ok: false, reason: 'refused', messages: ['This import is no eligible rows.'] });
  assert.equal(count(db, 'SELECT count(*) FROM parcels'), 0);
});

test('a stored parcel is never touched: a case-only match is skipped, its phone edit, spelling and events stay', async (t) => {
  const { db, dataDir } = await setup(t);
  const seed = checkImport(db, dataDir, { bytes: csv([HEADER, ['ab12', 'Shopee SHPE', 'Kim', '012345678', '2026-10-09 07:00:00']]), fileName: 's.csv', source: 'manual', userId: null, now: ON_SCAN_DAY });
  confirm(db, dataDir, seed.importId, { arrivalBatchDate: '2026-10-09', batchDateChosen: true });
  const id = count(db, "SELECT id FROM parcels WHERE tracking_key = 'AB12'");
  editParcelPhone(db, id, '099111222', null);
  const r = checkImport(db, dataDir, { bytes: csv([HEADER, ['AB12', 'Shopee SHPE', 'Other Name', '011222333', '2026-10-10 07:00:00']]), fileName: 'f.csv', source: 'manual', userId: null, now: ON_SCAN_DAY });
  const review = reviewImport(db, dataDir, r.importId, { kind: 'single_scan_date' }, ON_SCAN_DAY)!;
  assert.deepEqual(review.counts, { unique: 1, db_duplicate: 1, left_out: 0, blocked: 0, ready: 0 });
  assert.equal((review.items[0].detail as { caseOnly: boolean }).caseOnly, true);
  assert.deepEqual(confirm(db, dataDir, r.importId), { ok: true, added: 0 });
  assert.deepEqual(db.prepare('SELECT tracking_code, recipient_name, phone_raw, arrival_date FROM parcels WHERE id = ?').get(id), {
    tracking_code: 'ab12', recipient_name: 'Kim', phone_raw: '099111222', arrival_date: '2026-10-09',
  });
  assert.equal(count(db, 'SELECT count(*) FROM parcel_scan_events WHERE parcel_id = ?', id), 1, 'no scan events added to it');
  // insertNewParcels is what Confirm uses: it never overwrites either.
  assert.deepEqual(insertNewParcels(db, r.importId, [{ trackingCode: 'Ab12', recipientName: 'X', phoneRaw: null, arrivalDate: '2026-10-10' }]).inserted, []);
});

test('an error during Confirm rolls everything back and marks the import failed with its reason; cancel ends a review', async (t) => {
  const { db, dataDir } = await setup(t);
  const r = checkImport(db, dataDir, { bytes: fixture('scan-record-two-days.csv'), fileName: 'f.csv', source: 'manual', userId: null, now: ON_SCAN_DAY });
  fs.writeFileSync(path.join(dataDir, `imports/${db.prepare('SELECT sha256 FROM imports WHERE id = ?').pluck().get(r.importId)}`), 'changed');
  const failed = confirm(db, dataDir, r.importId, { dateChoice: { kind: 'all_on_batch_date' } });
  assert.equal(failed.ok, false);
  assert.match((failed as { messages: string[] }).messages[0], /nothing was saved: the stored file no longer matches/);
  assert.deepEqual(db.prepare('SELECT status, error_code FROM imports WHERE id = ?').get(r.importId), { status: 'failed', error_code: 'confirm_failed' });
  assert.equal(count(db, 'SELECT count(*) FROM parcels'), 0);

  const other = checkImport(db, dataDir, { bytes: fixture('scan-record-mixed.csv'), fileName: 'm.csv', source: 'manual', userId: null, now: ON_SCAN_DAY });
  assert.equal(cancelImport(db, other.importId, null), true);
  assert.equal(cancelImport(db, other.importId, null), false);
  assert.equal(count(db, 'SELECT count(*) FROM imports WHERE status = ?', 'cancelled'), 1);
});

test('retention keeps a stored file while a newer import of the same file still uses it', async (t) => {
  const { db, dataDir } = await setup(t);
  const bytes = fixture('scan-record-mixed.csv');
  const old = checkImport(db, dataDir, { bytes, fileName: 'a.csv', source: 'manual', userId: null, now: new Date('2026-09-01T03:00:00Z') });
  cancelImport(db, old.importId, null);
  const recent = checkImport(db, dataDir, { bytes, fileName: 'a.csv', source: 'manual', userId: null, now: ON_SCAN_DAY });
  const stored = path.join(dataDir, db.prepare('SELECT stored_path FROM imports WHERE id = ?').pluck().get(recent.importId) as string);
  purgeExpired(db, dataDir, ON_SCAN_DAY);
  assert.equal(count(db, 'SELECT count(*) FROM imports WHERE id = ?', old.importId), 0, 'the old import expired');
  assert.equal(fs.existsSync(stored), true, 'its file stays for the newer import');
  assert.equal(reviewImport(db, dataDir, recent.importId, null, ON_SCAN_DAY)!.live, true);
});
