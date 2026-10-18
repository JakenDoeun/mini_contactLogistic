// Data retention (plan Revision 4): every parcel and everything about it is deleted once it is N days old (default 7,
// admin setting 1–14), together with the activity log and backup history of that period. Accounts, settings and
// templates stay. Deletion runs with secure_delete (connection.ts), then a WAL truncate and VACUUM, so the bytes are gone.
import fs from 'node:fs';
import path from 'node:path';
import { writeAudit } from './audit.ts';
import type { Db } from './connection.ts';
import { cambodiaDate } from './values.ts';

export const RETENTION_KEY = 'retention.days';
export const DEFAULT_RETENTION_DAYS = 7;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 14;
const PURGE_MARKER = 'retention.purge_running'; // lets the append-only triggers (drizzle/0003) allow this job's deletes

const validDays = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= MIN_RETENTION_DAYS && (n as number) <= MAX_RETENTION_DAYS;

export function retentionDays(db: Db): number {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(RETENTION_KEY) as { value: string } | undefined;
  const days = row ? (JSON.parse(row.value) as unknown) : DEFAULT_RETENTION_DAYS;
  return validDays(days) ? days : DEFAULT_RETENTION_DAYS;
}

export type SetRetentionResult = { ok: true } | { ok: false; reason: 'not_admin' | 'invalid_days' };

/** Only an admin account may change it; the change is audited. */
export function setRetentionDays(db: Db, userId: number, days: unknown, now = new Date()): SetRetentionResult {
  if (!validDays(days)) return { ok: false, reason: 'invalid_days' };
  return db.transaction((): SetRetentionResult => {
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ? AND disabled = 0').get(userId) as { is_admin: number } | undefined;
    if (!user?.is_admin) {
      writeAudit(db, { action: 'settings.refused', entity: 'settings', entityIds: [], outcome: 'refused', userId, at: now.toISOString(), detail: { error_code: 'not_admin', settings_keys: [RETENTION_KEY] } });
      return { ok: false, reason: 'not_admin' };
    }
    db.prepare(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(RETENTION_KEY, JSON.stringify(days), userId, now.toISOString());
    writeAudit(db, { action: 'settings.changed', entity: 'settings', entityIds: [], outcome: 'ok', userId, at: now.toISOString(), detail: { settings_keys: [RETENTION_KEY], retention_days: days } });
    return { ok: true };
  }).immediate();
}

/** The last arrival date that is deleted today: with 7 days, on 17 Oct everything that arrived on 10 Oct or earlier. */
export function cutoffDate(days: number, now = new Date()): string {
  const today = new Date(`${cambodiaDate(now)}T00:00:00Z`);
  return new Date(today.getTime() - days * 24 * 3600_000).toISOString().slice(0, 10);
}

export type PurgeCounts = Record<string, number>;
const OLD = (column: string) => `date(${column}, '+7 hours') <= @cutoff`; // a UTC timestamp's Cambodia date

/**
 * Deletes everything older than the retention period in one transaction. Foreign keys are switched off for it (the
 * imports <-> detected_files references form a cycle) and checked before COMMIT, so a mistake rolls everything back.
 * `dataDir` is where stored import files may live; only files inside it are removed.
 */
export function purgeExpired(db: Db, dataDir: string, now = new Date()): { cutoff: string; counts: PurgeCounts; total: number } {
  const days = retentionDays(db);
  const cutoff = cutoffDate(days, now);
  const at = now.toISOString();
  const counts: PurgeCounts = {};
  const run = (name: string, sql: string, params: Record<string, unknown> = {}) => {
    counts[name] = (counts[name] ?? 0) + db.prepare(sql).run({ cutoff, ...params }).changes;
  };
  const storedFiles: string[] = [];

  db.pragma('foreign_keys = OFF');
  try {
    if (db.pragma('foreign_keys', { simple: true }) !== 0) throw new Error('SQLite kept foreign keys on');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, 'true', ?)").run(PURGE_MARKER, at);
      const oldParcels = `SELECT id FROM parcels WHERE arrival_date <= @cutoff`;
      run('notification_parcels', `DELETE FROM notification_parcels WHERE parcel_id IN (${oldParcels})`);
      run('contact_attempt_parcels', `DELETE FROM contact_attempt_parcels WHERE parcel_id IN (${oldParcels})`);
      run('parcel_scan_events', `DELETE FROM parcel_scan_events WHERE parcel_id IN (${oldParcels})`);
      run('parcel_phone_changes', `DELETE FROM parcel_phone_changes WHERE parcel_id IN (${oldParcels})`);
      run('import_review_items', `DELETE FROM import_review_items WHERE existing_parcel_id IN (${oldParcels})`);
      run('parcels', 'DELETE FROM parcels WHERE arrival_date <= @cutoff');

      const orphanNotifications = `SELECT id FROM notifications n WHERE ${OLD('n.created_at')} AND NOT EXISTS (SELECT 1 FROM notification_parcels np WHERE np.notification_id = n.id)`;
      run('sms_attempts', `DELETE FROM sms_attempts WHERE notification_id IN (${orphanNotifications})`);
      run('notifications', `DELETE FROM notifications WHERE id IN (${orphanNotifications})`);
      run('send_batches', `DELETE FROM send_batches WHERE ${OLD('created_at')} AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.batch_id = send_batches.id)`);
      run('contact_attempts', `DELETE FROM contact_attempts WHERE ${OLD('created_at')} AND NOT EXISTS (SELECT 1 FROM contact_attempt_parcels c WHERE c.contact_attempt_id = contact_attempts.id)`);

      const gone = expiredImports(db, cutoff);
      const ids = JSON.stringify([...gone]);
      for (const r of db.prepare('SELECT stored_path FROM imports WHERE id IN (SELECT value FROM json_each(?))').all(ids) as { stored_path: string }[]) {
        storedFiles.push(r.stored_path);
      }
      run('import_review_items', 'DELETE FROM import_review_items WHERE import_id IN (SELECT value FROM json_each(@ids))', { ids });
      run(
        'detected_files',
        `DELETE FROM detected_files WHERE import_id IN (SELECT value FROM json_each(@ids))
           OR (import_id IS NULL AND ${OLD('first_seen_at')} AND NOT EXISTS (SELECT 1 FROM imports i WHERE i.detected_file_id = detected_files.id))`,
        { ids },
      );
      run('imports', 'DELETE FROM imports WHERE id IN (SELECT value FROM json_each(@ids))', { ids });

      run('audit_log', `DELETE FROM audit_log WHERE ${OLD('at')}`);
      run('backup_runs', `DELETE FROM backup_runs WHERE ${OLD('at')}`);
      db.prepare('DELETE FROM settings WHERE key = ?').run(PURGE_MARKER);

      const violations = db.pragma('foreign_key_check') as unknown[];
      if (violations.length) throw new Error(`retention would break ${violations.length} reference(s): ${JSON.stringify(violations.slice(0, 5))}`);
      for (const k of Object.keys(counts)) if (!counts[k]) delete counts[k];
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      if (total) writeAudit(db, { action: 'retention.purged', entity: 'retention', entityIds: [], outcome: 'ok', at, detail: { retention_days: days, cutoff_date: cutoff, counts } });
      db.exec('COMMIT');
    } catch (e) {
      if (db.inTransaction) db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const file of storedFiles) removeInside(dataDir, file);
  if (total) {
    // secure_delete zeroed the freed pages; this also drops the old page images still in the WAL file.
    db.pragma('wal_checkpoint(TRUNCATE)');
    try {
      db.exec('VACUUM');
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      console.error(`retention: VACUUM skipped (${(e as Error).message}); deleted rows are already overwritten`);
    }
  }
  return { cutoff, counts, total };
}

/**
 * Imports checked on or before the cutoff that nothing kept still points to. Shrinks the candidate set until stable:
 * a kept parcel, scan event, rerun or detected file referring to an import keeps that import.
 */
function expiredImports(db: Db, cutoff: string): Set<number> {
  const gone = new Set((db.prepare(`SELECT id FROM imports WHERE ${OLD('checked_at')}`).all({ cutoff }) as { id: number }[]).map((r) => r.id));
  const refs = db.prepare('SELECT first_import_id AS id FROM parcels UNION SELECT import_id FROM parcel_scan_events').all() as { id: number }[];
  for (const r of refs) gone.delete(r.id);
  const reruns = db.prepare('SELECT id, rerun_of_import_id AS of, detected_file_id AS file FROM imports').all() as { id: number; of: number | null; file: number | null }[];
  const files = db.prepare('SELECT id, import_id FROM detected_files WHERE import_id IS NOT NULL').all() as { id: number; import_id: number }[];
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of reruns) {
      if (gone.has(r.id)) continue;
      if (r.of !== null && gone.delete(r.of)) changed = true;
      // A kept import's detected file stays, so the import that file points to stays too.
      const f = files.find((x) => x.id === r.file);
      if (f && gone.delete(f.import_id)) changed = true;
    }
  }
  return gone;
}

function removeInside(dataDir: string, file: string) {
  const abs = path.resolve(dataDir, file);
  const rel = path.relative(path.resolve(dataDir), abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return; // never outside the data folder
  fs.rmSync(abs, { force: true });
}
