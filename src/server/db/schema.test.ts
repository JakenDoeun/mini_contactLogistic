import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import type { Db } from './connection.ts';
import { ALL_TABLES } from './schema.ts';
import { createTestDb } from './test-db.ts';
import { parseScanTime, trackingKey } from './values.ts';

let db: Db;
let cleanup: () => void;
before(async () => ({ db, cleanup } = await createTestDb()));
after(() => cleanup());

const AT = '2026-10-12T01:00:00.000Z';
let seq = 0;

/** A valid import row (status `checked` unless overridden); returns its id. */
function addImport(fields: Record<string, unknown> = {}): number {
  const row: Record<string, unknown> = {
    source: 'manual', original_filename: 'scan-record-mixed.xlsx', stored_path: '/tmp/x', sha256: `h${++seq}`, size_bytes: 10,
    file_format: 'xlsx', status: 'checked', rules: '[]', headers_found: '{}', scan_dates: '{}', rows_total: 3, rows_shopee: 2,
    rows_excluded: 1, excluded_codes: 1, rows_collapsed: 0, parcels_unique: 2, db_duplicates: 0, left_out: 0, blocked: 0,
    ready: 2, parcels_added: 0, checked_at: AT, ...fields,
  };
  const cols = Object.keys(row);
  const sql = `INSERT INTO imports (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`;
  return Number(db.prepare(sql).run(row).lastInsertRowid);
}
const confirmed = { status: 'imported', confirmed_at: AT, arrival_batch_date: '2026-10-12', date_choice: 'single_scan_date', parcels_added: 2 };

function addParcel(code: string, importId: number, fields: Record<string, unknown> = {}): number {
  const row = {
    tracking_code: code, tracking_key: trackingKey(code), recipient_name: 'Test Customer', import_phone_raw: '012345670',
    phone_raw: '012345670', phone_normalized: '012345670', phone_edited: 0, arrival_date: '2026-10-12', first_import_id: importId,
    created_at: AT, updated_at: AT, ...fields,
  };
  const cols = Object.keys(row);
  return Number(db.prepare(`INSERT INTO parcels (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row).lastInsertRowid);
}

const rejects = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, pattern);

test('the Drizzle schema and the migrated database have the same 18 tables and columns', () => {
  assert.equal(ALL_TABLES.length, 18);
  for (const table of ALL_TABLES) {
    const config = getTableConfig(table);
    const dbColumns = (db.pragma(`table_info(${config.name})`) as { name: string }[]).map((c) => c.name).sort();
    assert.deepEqual(dbColumns, config.columns.map((c) => c.name).sort(), config.name);
  }
});

test('every index in the Drizzle schema exists in the database, with the same columns and uniqueness', () => {
  const declared = ALL_TABLES.flatMap((table) => {
    const config = getTableConfig(table);
    return config.indexes.map((i) => ({
      name: i.config.name,
      table: config.name,
      unique: i.config.unique ? 1 : 0,
      columns: i.config.columns.map((c) => (c as { name: string }).name),
    }));
  });
  const actual = (db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'").all() as {
    name: string; tbl_name: string;
  }[]).map((r) => ({
    name: r.name,
    table: r.tbl_name,
    unique: (db.pragma(`index_list(${r.tbl_name})`) as { name: string; unique: number }[]).find((x) => x.name === r.name)!.unique,
    columns: (db.pragma(`index_info(${r.name})`) as { seqno: number; name: string }[]).sort((a, b) => a.seqno - b.seqno).map((c) => c.name),
  }));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  assert.equal(declared.length, 28);
  assert.deepEqual(actual.sort(byName), declared.sort(byName));
});

test('CHECK, UNIQUE and key constraints on the notification, contact and system tables', () => {
  const imp = addImport();
  const parcel = addParcel('CK000000001', imp);
  const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...params).lastInsertRowid;

  const batch = (status: string, planned = 1, key = `rk${++seq}`) =>
    run("INSERT INTO send_batches (request_key, arrival_date, planned_messages, planned_parcels, status, created_at) VALUES (?, '2026-10-14', ?, ?, ?, ?)", key, planned, planned, status, AT);
  batch('running', 1, 'same-key');
  rejects(() => batch('done', 1, 'same-key'), /UNIQUE constraint failed: send_batches.request_key/);
  rejects(() => batch('sending'), /send_batches_status/);
  rejects(() => batch('done', -1), /send_batches_counts/);

  const note = Number(run("INSERT INTO notifications (phone_normalized, arrival_date, message_text, reason, created_at) VALUES ('012345670', '2026-10-14', 'm', 'initial', ?)", AT));
  rejects(() => run("INSERT INTO notifications (phone_normalized, arrival_date, message_text, reason, created_at) VALUES ('012345670', '2026-10-14', 'm', 'reminder', ?)", AT), /notifications_reason/);
  rejects(() => run("INSERT INTO notifications (phone_normalized, arrival_date, message_text, reason, created_at) VALUES (NULL, '2026-10-14', 'm', 'initial', ?)", AT), /NOT NULL/);
  run('INSERT INTO notification_parcels (notification_id, parcel_id) VALUES (?, ?)', note, parcel);
  rejects(() => run('INSERT INTO notification_parcels (notification_id, parcel_id) VALUES (?, ?)', note, parcel), /UNIQUE constraint failed/);
  rejects(() => run('INSERT INTO notification_parcels (notification_id, parcel_id) VALUES (?, 999999)', note), /FOREIGN KEY/);

  const attempt = (id: string | null, no: number, state = 'queued') =>
    run('INSERT INTO sms_attempts (id, notification_id, attempt_no, state, queued_at) VALUES (?, ?, ?, ?, ?)', id, note, no, state, AT);
  attempt('11111111-1111-4111-8111-111111111111', 1);
  rejects(() => attempt('22222222-2222-4222-8222-222222222222', 1), /UNIQUE constraint failed: sms_attempts.notification_id, sms_attempts.attempt_no/);
  rejects(() => attempt('11111111-1111-4111-8111-111111111111', 2), /UNIQUE constraint failed: sms_attempts.id/);
  rejects(() => attempt('33333333-3333-4333-8333-333333333333', 0), /sms_attempts_attempt_no/);
  rejects(() => attempt('44444444-4444-4444-8444-444444444444', 3, 'lost'), /sms_attempts_state/);
  rejects(() => attempt(null, 4), /NOT NULL constraint failed: sms_attempts.id/);

  const contact = (channel: string, outcome: string) =>
    run('INSERT INTO contact_attempts (channel, outcome, created_at) VALUES (?, ?, ?)', channel, outcome, AT);
  const c = contact('telegram', 'messaged');
  rejects(() => contact('sms', 'reached'), /contact_attempts_channel/);
  rejects(() => contact('call', 'busy'), /contact_attempts_outcome/);
  run('INSERT INTO contact_attempt_parcels (contact_attempt_id, parcel_id) VALUES (?, ?)', c, parcel);
  rejects(() => run('INSERT INTO contact_attempt_parcels (contact_attempt_id, parcel_id) VALUES (?, ?)', c, parcel), /UNIQUE constraint failed/);

  const file = (state: string, size = 10) =>
    run("INSERT INTO detected_files (path, size_bytes, modified_at, state, first_seen_at) VALUES ('/w/a.xlsx', ?, ?, ?, ?)", size, AT, state, AT);
  file('waiting');
  rejects(() => file('waiting'), /UNIQUE constraint failed: detected_files.path/);
  rejects(() => file('importing', 11), /detected_files_state/);

  const backup = (kind: string, drive: string | null, outcome = 'ok') =>
    run('INSERT INTO backup_runs (at, kind, drive, outcome) VALUES (?, ?, ?, ?)', AT, kind, drive, outcome);
  backup('off_machine', 'B');
  rejects(() => backup('cloud', null), /backup_runs_kind/);
  rejects(() => backup('off_machine', 'C'), /backup_runs_drive/);
  rejects(() => backup('local', null, 'partial'), /backup_runs_outcome/);

  run("INSERT INTO settings (key, value, updated_at) VALUES ('rate', '{\"per_minute\":6}', ?)", AT);
  rejects(() => run("INSERT INTO settings (key, value, updated_at) VALUES ('bad', 'not json', ?)", AT), /settings_value_json/);
  rejects(() => run("INSERT INTO settings (key, value, updated_at) VALUES ('rate', '{}', ?)", AT), /UNIQUE constraint failed: settings.key/);

  const user = Number(run("INSERT INTO users (username, password_hash, created_at) VALUES ('staff', 'scrypt$x', ?)", AT));
  rejects(() => run("INSERT INTO users (username, password_hash, created_at) VALUES ('staff', 'scrypt$y', ?)", AT), /UNIQUE constraint failed: users.username/);
  rejects(() => run("INSERT INTO users (username, password_hash, disabled, created_at) VALUES ('other', 'scrypt$z', 2, ?)", AT), /users_disabled_bool/);
  run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES ('t1', ?, ?, ?, ?)", user, AT, AT, AT);
  rejects(() => run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES ('t2', 999999, ?, ?, ?)", AT, AT, AT), /FOREIGN KEY/);
  rejects(() => run('DELETE FROM users WHERE id = ?', user), /FOREIGN KEY/);

  run("INSERT INTO worker_lease (id, holder, expires_at) VALUES (1, 'worker-a', ?)", AT);
  rejects(() => run("INSERT INTO worker_lease (id, holder, expires_at) VALUES (2, 'worker-b', ?)", AT), /worker_lease_single_row/);
});

test('foreign keys are enforced in normal use', () => {
  rejects(() => addParcel('FK000000001', 999_999), /FOREIGN KEY/);
});

test('import counts must add up and status rules hold', () => {
  rejects(() => addImport({ rows_total: 5 }), /CHECK constraint failed: imports_rows_identity/);
  rejects(() => addImport({ rows_collapsed: 1 }), /imports_collapsed_identity/);
  rejects(() => addImport({ ready: 1 }), /imports_parcels_identity/);
  rejects(() => addImport({ parcels_added: 2 }), /imports_status_rules/); // checked never has inserted parcels
  rejects(() => addImport({ ...confirmed, confirmed_at: null }), /imports_status_rules/);
  rejects(() => addImport({ ...confirmed, arrival_batch_date: null }), /imports_status_rules/);
  rejects(() => addImport({ ...confirmed, parcels_added: 1 }), /imports_status_rules/);
  rejects(() => addImport({ status: 'failed' }), /imports_status_rules/); // failed needs its reason
  rejects(() => addImport({ status: 'cancelled', confirmed_at: AT }), /imports_status_rules/);
  rejects(() => addImport({ date_choice: 'only_scan_date' }), /imports_chosen_scan_date/);
  rejects(() => addImport({ status: 'bogus' }), /imports_status/);
  addImport({ status: 'failed', error_code: 'missing_send_outlet', rows_total: 0, rows_shopee: 0, rows_excluded: 0, excluded_codes: 0, parcels_unique: 0, ready: 0 });
  addImport({ ...confirmed, date_choice: 'only_scan_date', chosen_scan_date: '2026-10-10' });
});

test('import status changes: only checked -> imported, failed or cancelled', () => {
  const id = addImport();
  rejects(() => db.prepare("UPDATE imports SET status = 'no_eligible_rows' WHERE id = ?").run(id), /only checked/);
  db.prepare("UPDATE imports SET status = 'imported', confirmed_at = ?, arrival_batch_date = '2026-10-12', date_choice = 'single_scan_date', parcels_added = 2 WHERE id = ?").run(AT, id);
  rejects(() => db.prepare("UPDATE imports SET status = 'checked', confirmed_at = NULL, parcels_added = 0 WHERE id = ?").run(id), /only checked/);
  rejects(() => db.prepare("UPDATE imports SET status = 'cancelled', confirmed_at = NULL, parcels_added = 0 WHERE id = ?").run(id), /only checked/);
  const failed = addImport();
  db.prepare("UPDATE imports SET status = 'failed', error_code = 'confirm_failed' WHERE id = ?").run(failed);
  rejects(() => db.prepare("UPDATE imports SET status = 'checked' WHERE id = ?").run(failed), /only checked/);
});

test('tracking key: case-insensitive only, internal spaces and leading zeros kept', () => {
  const imp = addImport();
  addParcel('S000000018', imp);
  rejects(() => addParcel('s000000018', imp), /UNIQUE constraint failed: parcels.tracking_key/);
  addParcel('00000000000017', imp);
  addParcel('AB 12', imp);
  addParcel('AB12', imp); // a different parcel: the space is part of the code
  rejects(() => addParcel('ab 13', imp, { tracking_key: 'AB13' }), /parcels_tracking_key_rule/);
  rejects(() => addParcel(' AB 14', imp, { tracking_key: ' AB 14' }), /parcels_tracking_code_nonempty/);
  const stored = db.prepare("SELECT tracking_code, tracking_key FROM parcels WHERE tracking_key IN ('S000000018', '00000000000017', 'AB 12') ORDER BY id").all();
  assert.deepEqual(stored, [
    { tracking_code: 'S000000018', tracking_key: 'S000000018' },
    { tracking_code: '00000000000017', tracking_key: '00000000000017' },
    { tracking_code: 'AB 12', tracking_key: 'AB 12' },
  ]);
  for (const sample of ['s000000018', 'ab 12', '0001x', 'éß ǆ ab']) {
    assert.equal((db.prepare('SELECT upper(?) AS u').get(sample) as { u: string }).u, trackingKey(sample), sample);
  }
});

test('phones: import phone never changes, an edited phone is marked and the mark is never reset', () => {
  const imp = addImport();
  const id = addParcel('PH000000001', imp);
  rejects(() => db.prepare("UPDATE parcels SET phone_raw = '099999999' WHERE id = ?").run(id), /parcels_phone_unedited/);
  rejects(() => db.prepare("UPDATE parcels SET import_phone_raw = '099999999' WHERE id = ?").run(id), /import_phone_raw never changes/);
  db.prepare("UPDATE parcels SET phone_raw = '099999999', phone_normalized = '099999999', phone_edited = 1 WHERE id = ?").run(id);
  rejects(() => db.prepare('UPDATE parcels SET phone_edited = 0 WHERE id = ?').run(id), /never reset/);
});

test('append-only tables cannot be changed or deleted', () => {
  const imp = addImport();
  const parcel = addParcel('AO000000001', imp);
  const change = db.prepare("INSERT INTO parcel_phone_changes (parcel_id, old_raw, new_raw, changed_at) VALUES (?, 'a', 'b', ?)").run(parcel, AT).lastInsertRowid;
  rejects(() => db.prepare("UPDATE parcel_phone_changes SET new_raw = 'c' WHERE id = ?").run(change), /append-only/);
  rejects(() => db.prepare('DELETE FROM parcel_phone_changes WHERE id = ?').run(change), /append-only/);
  const audit = db.prepare("INSERT INTO audit_log (at, action, entity, entity_ids, outcome) VALUES (?, 'x.y', 'x', '[1]', 'ok')").run(AT).lastInsertRowid;
  rejects(() => db.prepare("UPDATE audit_log SET outcome = 'failed' WHERE id = ?").run(audit), /append-only/);
  rejects(() => db.prepare('DELETE FROM audit_log WHERE id = ?').run(audit), /append-only/);
  rejects(() => db.prepare("INSERT INTO audit_log (at, action, entity, entity_ids, outcome, detail) VALUES (?, 'x.y', 'x', '[1]', 'ok', '[1]')").run(AT), /audit_log_detail_json/);
  const note = db.prepare("INSERT INTO notifications (phone_normalized, arrival_date, message_text, reason, created_at) VALUES ('012345670', '2026-10-12', 'm', 'initial', ?)").run(AT).lastInsertRowid;
  db.prepare('INSERT INTO notification_parcels (notification_id, parcel_id) VALUES (?, ?)').run(note, parcel);
  rejects(() => db.prepare('DELETE FROM notification_parcels WHERE notification_id = ?').run(note), /append-only/);
  rejects(() => db.prepare('DELETE FROM notifications WHERE id = ?').run(note), /append-only/);
  const contact = db.prepare("INSERT INTO contact_attempts (channel, outcome, created_at) VALUES ('call', 'reached', ?)").run(AT).lastInsertRowid;
  db.prepare('INSERT INTO contact_attempt_parcels (contact_attempt_id, parcel_id) VALUES (?, ?)').run(contact, parcel);
  rejects(() => db.prepare('DELETE FROM contact_attempt_parcels WHERE contact_attempt_id = ?').run(contact), /append-only/);
  rejects(() => db.prepare('DELETE FROM contact_attempts WHERE id = ?').run(contact), /append-only/);
  const backup = db.prepare("INSERT INTO backup_runs (at, kind, outcome) VALUES (?, 'local', 'ok')").run(AT).lastInsertRowid;
  rejects(() => db.prepare('DELETE FROM backup_runs WHERE id = ?').run(backup), /append-only/);
  rejects(() => db.prepare('DELETE FROM parcels WHERE id = ?').run(parcel), /FOREIGN KEY/);
});

test('review items: only the resolution changes, only while the import is checked, never deleted', () => {
  const imp = addImport();
  const add = (kind: string, blocking: number, key = 'S000000018') =>
    db.prepare("INSERT INTO import_review_items (import_id, tracking_key, kind, blocking, detail, created_at) VALUES (?, ?, ?, ?, '{}', ?)").run(imp, key, kind, blocking, AT).lastInsertRowid;
  rejects(() => add('recipient_conflict', 0), /review_items_blocking/);
  rejects(() => add('db_duplicate', 1), /review_items_blocking/);
  const item = add('code_spelling', 1);
  rejects(() => add('code_spelling', 1), /UNIQUE constraint failed/);
  rejects(() => db.prepare("UPDATE import_review_items SET resolution = 'chosen', resolved_at = ? WHERE id = ?").run(AT, item), /review_items_chosen_present/);
  rejects(() => db.prepare("UPDATE import_review_items SET resolution = 'left_out' WHERE id = ?").run(item), /review_items_resolved_at/);
  rejects(() => db.prepare("UPDATE import_review_items SET detail = '{\"x\":1}' WHERE id = ?").run(item), /only the resolution can change/);
  db.prepare(`UPDATE import_review_items SET resolution = 'chosen', chosen = '{"tracking_code":"S000000018"}', resolved_at = ? WHERE id = ?`).run(AT, item);
  rejects(() => db.prepare('DELETE FROM import_review_items WHERE id = ?').run(item), /append-only/);
  db.prepare("UPDATE imports SET status = 'cancelled' WHERE id = ?").run(imp);
  rejects(() => db.prepare("UPDATE import_review_items SET resolution = 'left_out' WHERE id = ?").run(item), /read-only once/);
  rejects(() => add('db_duplicate', 0, 'OTHER'), /no longer being reviewed/);
});

test('local dates must be real calendar dates (decision on finding I2)', () => {
  const valid = ['2026-10-14', '2026-01-31', '2026-04-30', '2026-12-31', '2028-02-29', '2000-02-29'];
  const impossible = ['2026-02-29', '2027-02-29', '1900-02-29', '2026-02-30', '2026-04-31', '2026-02-32', '2026-13-01', '2026-00-10', '2026-10-00', '2026-19-39'];
  // The runtime this runs on is the one the app uses: check its date() behaves as the triggers assume.
  for (const d of valid) assert.equal((db.prepare('SELECT date(?) IS ? AS ok').get(d, d) as { ok: number }).ok, 1, d);
  for (const d of impossible) assert.equal((db.prepare('SELECT date(?) IS ? AS ok').get(d, d) as { ok: number }).ok, 0, d);

  const imp = addImport();
  let n = 0;
  for (const d of valid) addParcel(`DT${String(++n).padStart(9, '0')}`, imp, { arrival_date: d });
  for (const d of impossible) rejects(() => addParcel(`DT${String(++n).padStart(9, '0')}`, imp, { arrival_date: d }), /arrival_date is not a real calendar date/);
  const parcel = addParcel('DT999999999', imp);
  rejects(() => db.prepare("UPDATE parcels SET arrival_date = '2026-02-30' WHERE id = ?").run(parcel), /not a real calendar date/);
  db.prepare("UPDATE parcels SET arrival_date = '2028-02-29' WHERE id = ?").run(parcel);

  addImport({ ...confirmed, date_choice: 'only_scan_date', chosen_scan_date: '2028-02-29', arrival_batch_date: '2028-02-29' });
  rejects(() => addImport({ ...confirmed, arrival_batch_date: '2026-02-30' }), /imports: .* not a real calendar date/);
  rejects(() => addImport({ ...confirmed, date_choice: 'only_scan_date', chosen_scan_date: '2026-04-31' }), /imports: .* not a real calendar date/);
  const later = addImport();
  rejects(() => db.prepare("UPDATE imports SET arrival_batch_date = '2027-02-29' WHERE id = ?").run(later), /not a real calendar date/);
  db.prepare("UPDATE imports SET arrival_batch_date = '2026-10-14' WHERE id = ?").run(later);

  const item = (d: string) =>
    db.prepare("INSERT INTO import_review_items (import_id, tracking_key, kind, blocking, detail, parcel_scan_date, created_at) VALUES (?, ?, 'not_chosen_scan_date', 0, '{}', ?, ?)").run(later, `K${d}`, d, AT);
  item('2028-02-29');
  rejects(() => item('2026-02-30'), /parcel_scan_date is not a real calendar date/);

  const batch = (d: string) =>
    db.prepare("INSERT INTO send_batches (request_key, arrival_date, planned_messages, planned_parcels, status, created_at) VALUES (?, ?, 0, 0, 'done', ?)").run(`rk-${d}`, d, AT).lastInsertRowid;
  const b = batch('2026-10-14');
  rejects(() => batch('2026-13-01'), /send_batches: arrival_date is not a real calendar date/);
  rejects(() => db.prepare("UPDATE send_batches SET arrival_date = '2026-02-30' WHERE id = ?").run(b), /not a real calendar date/);

  const note = (d: string) =>
    db.prepare("INSERT INTO notifications (phone_normalized, arrival_date, message_text, reason, created_at) VALUES ('012345670', ?, 'm', 'initial', ?)").run(d, AT).lastInsertRowid;
  const nId = note('2026-10-14');
  rejects(() => note('2026-10-00'), /notifications: arrival_date is not a real calendar date/);
  rejects(() => db.prepare("UPDATE notifications SET arrival_date = '2026-02-29' WHERE id = ?").run(nId), /not a real calendar date/);
});

test('scan times: raw text always kept; parsed time and date only for a valid time', () => {
  const imp = addImport();
  const parcel = addParcel('SC000000001', imp);
  let row = 0;
  const addEvent = (raw: string | null, utc: string | null, date: string | null) =>
    db.prepare(
      `INSERT INTO parcel_scan_events (parcel_id, import_id, source_row, tracking_code_raw, scan_type_raw, scan_time_raw, scan_time_utc, scan_date, created_at)
       VALUES (?, ?, ?, 'SC000000001', 'arrived', ?, ?, ?, ?)`,
    ).run(parcel, imp, ++row, raw, utc, date, AT).lastInsertRowid;

  const valid = parseScanTime('2026-10-10 07:15:00')!;
  const ok = addEvent('2026-10-10 07:15:00', valid.utc, valid.date);
  for (const raw of ['2026-02-30 10:00:00', '2026-10-10 25:00:00', '10/10/2026 07:00', '46305.3', '', null]) {
    assert.equal(parseScanTime(raw), null);
    addEvent(raw, null, null); // stored as metadata, never as an event time
  }
  // The database refuses a parsed time that does not match a real, canonical raw text.
  rejects(() => addEvent('2026-02-30 10:00:00', '2026-03-02T03:00:00.000Z', '2026-02-30'), /scan_events_parsed_matches_raw/);
  rejects(() => addEvent('2026-10-10 25:00:00', '2026-10-10T18:00:00.000Z', '2026-10-10'), /scan_events_parsed_matches_raw/);
  rejects(() => addEvent('2026-10-10 07:15:00', '2026-10-10T07:15:00.000Z', '2026-10-10'), /scan_events_parsed_matches_raw/); // not converted from UTC+7
  rejects(() => addEvent('2026-10-10 07:15:00', valid.utc, null), /scan_events_parsed_pair/);
  rejects(() => addEvent(null, valid.utc, valid.date), /scan_events_parsed_matches_raw/);

  const earliest = db.prepare('SELECT min(scan_time_utc) AS t, min(scan_date) AS d, count(*) AS n FROM parcel_scan_events WHERE parcel_id = ?').get(parcel);
  assert.deepEqual(earliest, { t: valid.utc, d: '2026-10-10', n: 7 }, 'unreadable rows never become the earliest scan time');
  rejects(() => db.prepare("UPDATE parcel_scan_events SET scan_type_raw = 'x' WHERE id = ?").run(ok), /append-only/);
  rejects(() => db.prepare('DELETE FROM parcel_scan_events WHERE id = ?').run(ok), /append-only/);
});
