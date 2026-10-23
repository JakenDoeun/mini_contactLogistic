import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createUser } from '../auth/accounts.ts';
import { writeAudit } from './audit.ts';
import type { Db } from './connection.ts';
import { editParcelPhone, insertNewParcels } from './parcels.ts';
import { cutoffDate, nextDeletion, purgeExpired, retentionDays, setRetentionDays } from './retention.ts';
import { createTestDb } from './test-db.ts';
import { cambodiaDate } from './values.ts';

const NOW = new Date('2026-10-17T03:00:00.000Z'); // 10:00 in Cambodia
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600_000);
const PHONE = '012 345 678'; // test number searched for in the file bytes

/** One confirmed import of one parcel that arrived `age` days ago, with a phone edit, an SMS and a call note. */
function arrival(db: Db, age: number, code: string, storedPath = 'demo-seed') {
  const at = daysAgo(age).toISOString();
  const day = cambodiaDate(daysAgo(age));
  const importId = Number(
    db
      .prepare(
        `INSERT INTO imports (source, original_filename, stored_path, sha256, size_bytes, status, rules, headers_found, scan_dates,
           date_choice, arrival_batch_date, rows_total, rows_shopee, rows_excluded, excluded_codes, rows_collapsed, parcels_unique,
           db_duplicates, left_out, blocked, ready, parcels_added, checked_at)
         VALUES ('seed', ?, ?, ?, 0, 'checked', '[]', '{}', '{}', 'single_scan_date', ?, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, ?)`,
      )
      .run(`f-${code}`, storedPath, 'a'.repeat(64), day, at).lastInsertRowid,
  );
  const [parcelId] = insertNewParcels(db, importId, [{ trackingCode: code, recipientName: `Name ${code}`, phoneRaw: PHONE, arrivalDate: day }], at).inserted;
  db.prepare("UPDATE imports SET status = 'imported', parcels_added = 1, confirmed_at = ? WHERE id = ?").run(at, importId);
  editParcelPhone(db, parcelId, `${PHONE}9`, null, at);
  const n = Number(db.prepare("INSERT INTO notifications (phone_normalized, arrival_date, message_text, reason, created_at) VALUES ('85512345678', ?, ?, 'initial', ?)").run(day, `Hi, parcel ${code} arrived`, at).lastInsertRowid);
  db.prepare('INSERT INTO notification_parcels VALUES (?, ?)').run(n, parcelId);
  db.prepare("INSERT INTO sms_attempts (id, notification_id, attempt_no, state, queued_at) VALUES (?, ?, 1, 'sent', ?)").run(`sms-${code}`, n, at);
  const c = Number(db.prepare("INSERT INTO contact_attempts (channel, outcome, phone_normalized, created_at) VALUES ('call', 'reached', '85512345678', ?)").run(at).lastInsertRowid);
  db.prepare('INSERT INTO contact_attempt_parcels VALUES (?, ?)').run(c, parcelId);
  writeAudit(db, { action: 'import.confirmed', entity: 'import', entityIds: [importId], outcome: 'ok', at });
  return { importId, parcelId };
}

const count = (db: Db, table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

test('cutoff: with 7 days, on 17 Oct (Cambodia) everything that arrived on 10 Oct or earlier goes', () => {
  assert.equal(cutoffDate(7, NOW), '2026-10-10');
  assert.equal(cutoffDate(7, new Date('2026-10-16T17:30:00.000Z')), '2026-10-10', '00:30 on 17 Oct in Cambodia, still 16 Oct in UTC');
  assert.equal(cutoffDate(1, NOW), '2026-10-16');
});

test('retention: expired parcels and everything about them are deleted; recent ones, accounts and settings stay', async (t) => {
  const { db, dir, dbPath, cleanup } = await createTestDb();
  t.after(cleanup);
  await createUser(db, 'admin.one', 'correct horse battery', 'cli', NOW);
  fs.mkdirSync(path.join(dir, 'imports'));
  fs.writeFileSync(path.join(dir, 'imports', 'old.xlsx'), 'courier export');
  arrival(db, 8, 'OLD-1', 'imports/old.xlsx');
  arrival(db, 7, 'OLD-2');
  const recent = arrival(db, 6, 'NEW-1');
  writeAudit(db, { action: 'login.succeeded', entity: 'user', entityIds: [1], outcome: 'ok', at: daysAgo(9).toISOString() });

  const { cutoff, counts } = purgeExpired(db, dir, NOW);
  assert.equal(cutoff, '2026-10-10');
  assert.equal(counts.parcels, 2);
  assert.deepEqual(db.prepare('SELECT id FROM parcels').all(), [{ id: recent.parcelId }]);
  for (const table of ['imports', 'notifications', 'notification_parcels', 'sms_attempts', 'contact_attempts', 'contact_attempt_parcels', 'parcel_phone_changes']) {
    assert.equal(count(db, table), 1, `${table}: only the recent parcel's row is left`);
  }
  assert.equal(count(db, 'users'), 1, 'accounts are kept');
  assert.equal(fs.existsSync(path.join(dir, 'imports', 'old.xlsx')), false, 'the stored courier file is deleted too');
  const actions = (db.prepare('SELECT action FROM audit_log ORDER BY id').all() as { action: string }[]).map((r) => r.action);
  assert.deepEqual(actions, ['user.created', 'parcel.phone_edited', 'import.confirmed', 'retention.purged'], 'old log entries are gone; the purge itself is logged');
  assert.equal(db.prepare('SELECT 1 FROM settings WHERE key = ?').get('retention.purge_running'), undefined, 'no marker left behind');
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, 'foreign keys are back on');

  // The deleted names are no longer anywhere in the file or the WAL, only the recent parcel's.
  const bytes = Buffer.concat([fs.readFileSync(dbPath), fs.existsSync(`${dbPath}-wal`) ? fs.readFileSync(`${dbPath}-wal`) : Buffer.alloc(0)]);
  assert.equal(bytes.includes('Name OLD-1'), false);
  assert.equal(bytes.includes('parcel OLD-2 arrived'), false);
  assert.equal(purgeExpired(db, dir, NOW).total, 0, 'a second run finds nothing');
});

test('retention: outside the job, the append-only tables still refuse deletes', async (t) => {
  const { db, dir, cleanup } = await createTestDb();
  t.after(cleanup);
  arrival(db, 1, 'A-1');
  for (const table of ['parcel_phone_changes', 'notifications', 'notification_parcels', 'contact_attempts', 'audit_log']) {
    assert.throws(() => db.prepare(`DELETE FROM ${table}`).run(), /append-only/, table);
  }
  assert.equal(purgeExpired(db, dir, NOW).total, 0, 'nothing is old enough');
  assert.equal(count(db, 'parcels'), 1);
});

test('retention: a failure rolls everything back', async (t) => {
  const { db, dir, cleanup } = await createTestDb();
  t.after(cleanup);
  arrival(db, 10, 'OLD-1');
  db.exec('CREATE TABLE pin (parcel_id INTEGER REFERENCES parcels(id))');
  db.prepare('INSERT INTO pin VALUES (1)').run(); // a reference the job does not know about
  assert.throws(() => purgeExpired(db, dir, NOW), /would break 1 reference/);
  assert.equal(count(db, 'parcels'), 1);
  assert.equal(count(db, 'notifications'), 1);
  assert.equal(db.prepare('SELECT 1 FROM settings WHERE key = ?').get('retention.purge_running'), undefined);
});

test('retention setting: default 7; only the admin changes it, within 1–14, and it is audited', async (t) => {
  const { db, dir, cleanup } = await createTestDb();
  t.after(cleanup);
  const admin = await createUser(db, 'admin.one', 'correct horse battery', 'cli', NOW);
  const staff = await createUser(db, 'staff.two', 'correct horse battery', 'cli', NOW);
  assert.ok(admin.ok && staff.ok);
  assert.equal(retentionDays(db), 7);
  assert.deepEqual(setRetentionDays(db, staff.userId, 3, NOW), { ok: false, reason: 'not_admin' });
  for (const bad of [0, 15, 2.5, '3', null]) assert.deepEqual(setRetentionDays(db, admin.userId, bad, NOW), { ok: false, reason: 'invalid_days' }, String(bad));
  assert.equal(retentionDays(db), 7);
  assert.deepEqual(setRetentionDays(db, admin.userId, 3, NOW), { ok: true });
  assert.equal(retentionDays(db), 3);
  const audit = db.prepare("SELECT outcome, user_id, detail FROM audit_log WHERE action LIKE 'settings.%' ORDER BY id").all() as { outcome: string; user_id: number; detail: string }[];
  assert.deepEqual(audit.map((a) => [a.outcome, a.user_id]), [['refused', staff.userId], ['ok', admin.userId]]);
  assert.equal(JSON.parse(audit[1].detail).retention_days, 3);

  arrival(db, 3, 'D-3');
  arrival(db, 2, 'D-2');
  purgeExpired(db, dir, NOW);
  assert.equal(count(db, 'parcels'), 1, 'with 3 days, the parcel from 3 days ago is gone');
});

test('next deletion: after midnight the parcels that arrived on the next day past the cutoff go, counted by customer', async (t) => {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  arrival(db, 6, 'SIX-A'); // 11 Oct: with 7 days, deleted after midnight (cutoff 11 Oct on 18 Oct)
  arrival(db, 6, 'SIX-B'); // same customer (same number)
  arrival(db, 5, 'FIVE'); // 12 Oct: kept one more day
  assert.deepEqual(nextDeletion(db, NOW), { arrivedOn: '2026-10-11', parcels: 2, customers: 1 });
});
