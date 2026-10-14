// Migration runner (docs/phase1-schema.md, "Safe migration sequence").
// Drizzle's migrate() commits before any check can run and cannot switch foreign keys off, so the runner applies
// Drizzle's migration files itself, keeping Drizzle's __drizzle_migrations table format.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getTableName } from 'drizzle-orm';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import { openDatabase, type Db } from './connection.ts';
import { assertOutsideProject, MIGRATIONS_FOLDER } from './paths.ts';
import { ALL_TABLES } from './schema.ts';

export const EXPECTED_TABLES: readonly string[] = ALL_TABLES.map((t) => getTableName(t));

export type MigrationErrorCode =
  | 'migration_files_unreadable'
  | 'migration_changed'
  | 'migration_missing'
  | 'migration_out_of_order'
  | 'backup_failed'
  | 'foreign_keys_not_switched'
  | 'migration_failed'
  | 'foreign_key_violation'
  | 'integrity_failed'
  | 'self_test_failed';

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  constructor(code: MigrationErrorCode, message: string, options?: { cause?: unknown }) {
    super(`${code}: ${message}`, options);
    this.code = code;
  }
}

const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at numeric
)`;

export interface MigrateOptions {
  dbPath: string;
  backupDir: string;
  migrationsFolder?: string;
  now?: () => Date;
}

export interface MigrateResult {
  applied: number;
  backupPath: string | null;
}

function readMigrations(folder: string): MigrationMeta[] {
  try {
    return readMigrationFiles({ migrationsFolder: folder });
  } catch (e) {
    throw new MigrationError('migration_files_unreadable', `cannot read migrations in ${folder}`, { cause: e });
  }
}

const tableExists = (db: Db, name: string) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

function appliedMigrations(db: Db): { hash: string; createdAt: number }[] {
  if (!tableExists(db, '__drizzle_migrations')) return [];
  const rows = db.prepare('SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at').all() as {
    hash: string;
    created_at: number | string;
  }[];
  return rows.map((r) => ({ hash: r.hash, createdAt: Number(r.created_at) }));
}

/** Every applied migration must still exist with the same content (Drizzle's own migrator does not check this). */
function verifyApplied(applied: { hash: string; createdAt: number }[], files: MigrationMeta[]) {
  for (const a of applied) {
    const file = files.find((f) => f.folderMillis === a.createdAt);
    if (!file) throw new MigrationError('migration_missing', `applied migration ${a.createdAt} has no migration file`);
    if (file.hash !== a.hash) throw new MigrationError('migration_changed', `migration ${a.createdAt} was changed after it was applied`);
  }
}

async function copyBeforeMigrating(db: Db, backupDir: string, now: Date): Promise<string> {
  const dest = path.join(backupDir, `pre-migration-${now.toISOString().replace(/[:.]/g, '-')}.db`);
  try {
    assertOutsideProject(dest);
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    await db.backup(dest);
    fs.chmodSync(dest, 0o600);
    const copy = new Database(dest, { fileMustExist: true });
    try {
      // The copy inherits WAL mode; make it one self-contained file before checking it.
      copy.pragma('journal_mode = DELETE');
      const result = copy.pragma('integrity_check', { simple: true });
      if (result !== 'ok') throw new Error(`integrity_check on the copy returned ${String(result)}`);
    } finally {
      copy.close();
    }
    return dest;
  } catch (e) {
    throw new MigrationError('backup_failed', `could not copy the database before migrating (${(e as Error).message})`, { cause: e });
  }
}

/**
 * Steps 3–6: foreign keys off outside the transaction, every pending migration in one BEGIN IMMEDIATE transaction,
 * foreign_key_check and integrity_check before COMMIT, ROLLBACK on any error or finding. Foreign keys are always switched
 * back on afterwards. Returns how many migrations this call applied.
 */
export function applyPending(db: Db, pending: MigrationMeta[], backup: { path: string; at: string } | null): number {
  db.pragma('foreign_keys = OFF');
  try {
    if (db.pragma('foreign_keys', { simple: true }) !== 0) {
      throw new MigrationError('foreign_keys_not_switched', 'SQLite kept foreign keys on');
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      // Pending was worked out before the write lock: another process may have applied some of it since (finding H2).
      const appliedNow = new Map(appliedMigrations(db).map((a) => [a.createdAt, a.hash]));
      const todo = pending.filter((m) => {
        const hash = appliedNow.get(m.folderMillis);
        if (hash !== undefined && hash !== m.hash) throw new MigrationError('migration_changed', `migration ${m.folderMillis} was applied with other content`);
        return hash === undefined;
      });
      if (todo.length === 0) {
        db.exec('ROLLBACK');
        return 0;
      }
      db.exec(MIGRATIONS_TABLE);
      const record = db.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)');
      for (const migration of todo) {
        for (const statement of migration.sql) {
          if (statement.trim()) db.exec(statement);
        }
        record.run(migration.hash, migration.folderMillis);
      }
      if (backup && tableExists(db, 'backup_runs')) {
        db.prepare("INSERT INTO backup_runs (at, kind, snapshot_id, outcome) VALUES (?, 'pre_migration', ?, 'ok')").run(
          backup.at,
          path.basename(backup.path),
        );
      }
      const violations = db.pragma('foreign_key_check') as unknown[];
      if (violations.length > 0) {
        throw new MigrationError('foreign_key_violation', `${violations.length} row(s) break a foreign key: ${JSON.stringify(violations.slice(0, 5))}`);
      }
      const integrity = db.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new MigrationError('integrity_failed', `integrity_check returned ${String(integrity)}`);
      db.exec('COMMIT');
      return todo.length;
    } catch (e) {
      if (db.inTransaction) db.exec('ROLLBACK');
      throw e instanceof MigrationError ? e : new MigrationError('migration_failed', (e as Error).message, { cause: e });
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/** Step 7: the database the app is about to use is complete and consistent. */
export function selfTest(db: Db, files: MigrationMeta[]) {
  const fail = (why: string) => {
    throw new MigrationError('self_test_failed', why);
  };
  if (db.pragma('foreign_keys', { simple: true }) !== 1) fail('foreign keys are off');
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name),
  );
  const missing = EXPECTED_TABLES.filter((t) => !tables.has(t));
  if (missing.length) fail(`missing tables: ${missing.join(', ')}`);
  const applied = appliedMigrations(db);
  verifyApplied(applied, files);
  if (applied.length !== files.length) fail(`${applied.length} of ${files.length} migrations applied`);
  if ((db.pragma('foreign_key_check') as unknown[]).length) fail('foreign_key_check found violations');
  const quick = db.pragma('quick_check', { simple: true });
  if (quick !== 'ok') fail(`quick_check returned ${String(quick)}`);
  db.prepare('SELECT count(*) FROM settings').get();
}

/** Steps 1–8. Throws MigrationError on any failure; the caller must then not start the app. */
export async function migrateDatabase(options: MigrateOptions): Promise<MigrateResult> {
  const files = readMigrations(options.migrationsFolder ?? MIGRATIONS_FOLDER);
  const db = openDatabase(options.dbPath);
  try {
    const applied = appliedMigrations(db);
    verifyApplied(applied, files);
    const done = new Set(applied.map((a) => a.createdAt));
    const pending = files.filter((f) => !done.has(f.folderMillis));
    const latest = Math.max(-Infinity, ...applied.map((a) => a.createdAt));
    if (pending.some((f) => f.folderMillis < latest)) {
      throw new MigrationError('migration_out_of_order', 'a pending migration is older than one already applied');
    }
    let backupPath: string | null = null;
    let appliedCount = 0;
    if (pending.length > 0) {
      const now = (options.now ?? (() => new Date()))();
      const hasTables =
        (db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get() as { n: number }).n > 0;
      // A brand-new, empty database has nothing to lose; anything else is copied first.
      if (hasTables) backupPath = await copyBeforeMigrating(db, options.backupDir, now);
      appliedCount = applyPending(db, pending, backupPath ? { path: backupPath, at: now.toISOString() } : null);
    }
    selfTest(db, files);
    return { applied: appliedCount, backupPath };
  } finally {
    db.close();
  }
}

/** The data folder layout used by the scripts: <dataDir>/branch.db and <dataDir>/backups/. */
export const prepareDatabase = (dataDir: string) =>
  migrateDatabase({ dbPath: path.join(dataDir, 'branch.db'), backupDir: path.join(dataDir, 'backups') });
