// What the Windows updater asks before and after it switches versions (scripts/update.ts runs these for it).
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { listBackups } from '../db/backup.ts';
import type { Db } from '../db/connection.ts';

// A running batch hands one SMS to the phone every 25 to 80 seconds; one with no hand-over for this long is stalled
// (phone away, SIM missing) and loses nothing by a restart, which the worker resumes.
const ACTIVE_MS = 5 * 60_000;

/**
 * An SMS is being handed to the phone, or a batch is sending (started or handed one over in the last 5 minutes):
 * the updater waits before it stops the app (owner, 2026-10-27).
 */
export function smsBusy(db: Db, now = new Date()) {
  const since = new Date(now.getTime() - ACTIVE_MS).toISOString();
  return !!db
    .prepare(
      `SELECT 1 FROM sms_attempts WHERE state = 'submitting'
       UNION ALL
       SELECT 1 FROM send_batches b WHERE b.status = 'running' AND (b.created_at > @since OR EXISTS (
         SELECT 1 FROM notifications n JOIN sms_attempts a ON a.notification_id = n.id WHERE n.batch_id = b.id AND a.submitted_at > @since))
       LIMIT 1`,
    )
    .get({ since });
}

/** The database has migrations the version in `migrationsFolder` does not know, so that version cannot open it. */
export function databaseNewer(db: Db, migrationsFolder: string) {
  const known = readMigrationFiles({ migrationsFolder }).length;
  const applied = (db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
  return applied > known;
}

/** The number scripts/restore.ts gives the newest pre-migration copy (newest first, from 1), or null when there is none. */
export function newestPreMigration(dataDir: string) {
  const i = listBackups(dataDir).findIndex((b) => b.kind === 'pre-migration');
  return i < 0 ? null : i + 1;
}
