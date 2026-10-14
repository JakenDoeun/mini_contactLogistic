import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { openDatabase } from './connection.ts';
import { applyPending, EXPECTED_TABLES, migrateDatabase, MigrationError } from './migrate.ts';
import { assertInTempDir, DEV_DATA_DIR, MIGRATIONS_FOLDER, PROJECT_ROOT } from './paths.ts';
import { seedDemoData } from './seed.ts';
import { createTestDb, makeTempDir, removeTempDir } from './test-db.ts';

/** Number of committed migrations; test-only migrations are added after them. */
const COMMITTED = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')).entries.length as number;

type Extra = { tag: string; sql: string; offset?: number };

/** A temporary copy of the committed migrations plus extra test-only migrations. */
function migrationsFolder(dir: string, extra: Extra[] = []) {
  const folder = path.join(dir, 'migrations');
  fs.mkdirSync(path.join(folder, 'meta'), { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'));
  for (const entry of journal.entries) {
    fs.copyFileSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  }
  const base = journal.entries.at(-1).when;
  extra.forEach((m, i) => {
    fs.writeFileSync(path.join(folder, `${m.tag}.sql`), m.sql);
    journal.entries.push({ idx: journal.entries.length, version: '6', when: base + (m.offset ?? (i + 1) * 1000), tag: m.tag, breakpoints: true });
  });
  fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal, null, 2));
  return folder;
}

const userTables = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name").all() as {
    name: string;
  }[]).map((r) => r.name);
const schemaSql = (db: Database.Database) =>
  (db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as object[]);
const columns = (db: Database.Database, table: string) => (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
const migrationCount = (db: Database.Database) => (db.prepare('SELECT count(*) AS n FROM "__drizzle_migrations"').get() as { n: number }).n;
const snapshot = (db: Database.Database) => ({
  parcels: db.prepare('SELECT * FROM parcels ORDER BY id').all(),
  imports: db.prepare('SELECT * FROM imports ORDER BY id').all(),
  audit: db.prepare('SELECT * FROM audit_log ORDER BY id').all(),
  settings: db.prepare('SELECT * FROM settings ORDER BY key').all(),
});
const rejectsWith = (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (e: unknown) => e instanceof MigrationError && e.code === code);

/** A migrated database with demo data, in a temp folder with its own migrations copy. */
async function seededDb(t: TestContext) {
  const dir = makeTempDir();
  t.after(() => removeTempDir(dir));
  const folder = migrationsFolder(dir);
  const dbPath = path.join(dir, 'branch.db');
  const backupDir = path.join(dir, 'backups');
  await migrateDatabase({ dbPath, backupDir, migrationsFolder: folder });
  const db = openDatabase(dbPath);
  seedDemoData(db);
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('columns', '{\"tracking\":\"scan order number\"}', '2026-10-12T00:00:00.000Z')").run();
  const before = snapshot(db);
  db.close();
  return { dir, folder, dbPath, backupDir, before };
}

test('fresh database: all 18 tables, triggers, foreign keys and integrity', async (t) => {
  const { db, dir, cleanup } = await createTestDb();
  t.after(cleanup);
  assert.deepEqual(userTables(db), [...EXPECTED_TABLES].sort());
  assert.equal(userTables(db).length, 18);
  const triggers = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger'").get() as { n: number };
  assert.equal(triggers.n, 27, '18 from 0000 and 9 strict-date triggers from 0001');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(migrationCount(db), COMMITTED);
  assert.equal(fs.existsSync(path.join(dir, 'backups')), false, 'an empty new database needs no copy');
});

test('running the migrations again changes nothing and takes no copy', async (t) => {
  const { dir, folder, dbPath, backupDir, before } = await seededDb(t);
  const db0 = new Database(dbPath, { readonly: true });
  const schemaBefore = schemaSql(db0);
  db0.close();
  for (let i = 0; i < 2; i++) {
    const result = await migrateDatabase({ dbPath, backupDir, migrationsFolder: folder });
    assert.deepEqual(result, { applied: 0, backupPath: null });
  }
  const db = openDatabase(dbPath);
  t.after(() => db.close());
  assert.deepEqual(schemaSql(db), schemaBefore);
  assert.deepEqual(snapshot(db), before);
  assert.equal(fs.existsSync(backupDir), false);
  assert.ok(dir);
});

test('upgrade with data: copy first, data unchanged, copy recorded', async (t) => {
  const { folder, dbPath, backupDir, before, dir } = await seededDb(t);
  migrationsFolder(dir, [{ tag: '0001_settings_note', sql: 'ALTER TABLE `settings` ADD `note` text;' }]);
  const result = await migrateDatabase({ dbPath, backupDir, migrationsFolder: folder, now: () => new Date('2026-10-12T08:00:00.000Z') });
  assert.equal(result.applied, 1);
  assert.ok(result.backupPath && fs.existsSync(result.backupPath));
  assert.equal(fs.statSync(result.backupPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(backupDir).mode & 0o777, 0o700, 'the backups folder is created 0700');
  const copy = new Database(result.backupPath, { readonly: true });
  assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(snapshot(copy), before, 'the copy holds the data as it was before migrating');
  copy.close();
  const db = openDatabase(dbPath);
  t.after(() => db.close());
  assert.ok(columns(db, 'settings').includes('note'));
  assert.equal(migrationCount(db), COMMITTED + 1);
  const after = snapshot(db);
  assert.deepEqual(after.parcels, before.parcels);
  assert.deepEqual(after.imports, before.imports);
  assert.deepEqual(after.audit, before.audit);
  assert.deepEqual(db.prepare('SELECT kind, snapshot_id, outcome FROM backup_runs').all(), [
    { kind: 'pre_migration', snapshot_id: path.basename(result.backupPath), outcome: 'ok' },
  ]);
});

test('a failing statement rolls back the whole migration; the copy is kept', async (t) => {
  const { folder, dbPath, backupDir, before, dir } = await seededDb(t);
  migrationsFolder(dir, [
    {
      tag: '0001_broken',
      sql: 'ALTER TABLE `settings` ADD `note` text;\n--> statement-breakpoint\nCREATE TABLE `extra` (`id` integer);\n--> statement-breakpoint\nINSERT INTO `no_such_table` VALUES (1);',
    },
  ]);
  await rejectsWith(migrateDatabase({ dbPath, backupDir, migrationsFolder: folder }), 'migration_failed');
  const db = openDatabase(dbPath);
  t.after(() => db.close());
  assert.equal(columns(db, 'settings').includes('note'), false, 'no partial schema change');
  assert.equal(userTables(db).includes('extra'), false);
  assert.equal(migrationCount(db), COMMITTED);
  assert.deepEqual(snapshot(db), before);
  assert.deepEqual(db.prepare('SELECT * FROM backup_runs').all(), [], 'the copy record was rolled back with the migration');
  const copies = fs.readdirSync(backupDir);
  assert.equal(copies.length, 1);
  const copy = new Database(path.join(backupDir, copies[0]), { readonly: true });
  assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
  copy.close();
});

test('when the second of two pending migrations fails, neither is applied', async (t) => {
  const { folder, dbPath, backupDir, before, dir } = await seededDb(t);
  migrationsFolder(dir, [
    { tag: '0101_good', sql: 'ALTER TABLE `settings` ADD `note` text;\n--> statement-breakpoint\nCREATE TABLE `first_ok` (`id` integer);' },
    { tag: '0102_bad', sql: 'CREATE TABLE `second_part` (`id` integer);\n--> statement-breakpoint\nINSERT INTO `no_such_table` VALUES (1);' },
  ]);
  await rejectsWith(migrateDatabase({ dbPath, backupDir, migrationsFolder: folder }), 'migration_failed');
  const db = openDatabase(dbPath);
  t.after(() => db.close());
  assert.equal(columns(db, 'settings').includes('note'), false);
  assert.equal(userTables(db).includes('first_ok'), false, 'the first, valid migration was rolled back too');
  assert.equal(userTables(db).includes('second_part'), false);
  assert.equal(migrationCount(db), COMMITTED);
  assert.deepEqual(snapshot(db), before);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(fs.readdirSync(backupDir).length, 1, 'the pre-migration copy is kept');
});

test('a migration that breaks a foreign key is rolled back', async (t) => {
  const { folder, dbPath, backupDir, before, dir } = await seededDb(t);
  migrationsFolder(dir, [
    {
      tag: '0001_orphan',
      sql: "INSERT INTO `parcel_phone_changes` (`parcel_id`, `changed_at`) VALUES (999999, '2026-10-12T00:00:00.000Z');",
    },
  ]);
  await rejectsWith(migrateDatabase({ dbPath, backupDir, migrationsFolder: folder }), 'foreign_key_violation');
  const db = openDatabase(dbPath);
  t.after(() => db.close());
  assert.equal((db.prepare('SELECT count(*) AS n FROM parcel_phone_changes').get() as { n: number }).n, 0);
  assert.equal(migrationCount(db), COMMITTED);
  assert.deepEqual(snapshot(db), before);
});

test('foreign keys are switched off only inside the migration and always back on afterwards', async (t) => {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  const meta = (sql: string[], folderMillis: number) => ({ sql, folderMillis, hash: crypto.createHash('sha256').update(sql.join('')).digest('hex'), bps: true });
  // The migration sees foreign keys off: an orphan insert succeeds inside it, then foreign_key_check rejects it.
  assert.throws(
    () => applyPending(db, [meta(["INSERT INTO parcel_phone_changes (parcel_id, changed_at) VALUES (424242, 'x')"], 1)], null),
    (e: unknown) => e instanceof MigrationError && e.code === 'foreign_key_violation',
  );
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.throws(() => applyPending(db, [meta(['SELECT * FROM no_such_table'], 2)], null), MigrationError);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.inTransaction, false);
  applyPending(db, [meta(['CREATE TABLE ok_table (id integer)'], 3)], null);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('two start-ups at once apply a migration exactly once (finding H2)', async (t) => {
  const { folder, dbPath, backupDir, dir } = await seededDb(t);
  // A data migration with no unique key to stop a second run.
  migrationsFolder(dir, [
    { tag: '0001_data', sql: "INSERT INTO backup_runs (at, kind, outcome) VALUES ('2026-10-14T00:00:00.000Z', 'local', 'ok');" },
  ]);
  // Both calls work out the pending list before either reaches the write lock: each awaits its copy first.
  const results = await Promise.all([1, 2].map(() => migrateDatabase({ dbPath, backupDir, migrationsFolder: folder })));
  assert.deepEqual(results.map((r) => r.applied).sort(), [0, 1]);
  const db = openDatabase(dbPath);
  t.after(() => db.close());
  assert.equal((db.prepare("SELECT count(*) AS n FROM backup_runs WHERE kind = 'local'").get() as { n: number }).n, 1);
  assert.equal(migrationCount(db), COMMITTED + 1);
  assert.equal((db.prepare("SELECT count(*) AS n FROM backup_runs WHERE kind = 'pre_migration'").get() as { n: number }).n, 1, 'only the run that migrated records its copy');
  db.close();
  assert.deepEqual(await migrateDatabase({ dbPath, backupDir, migrationsFolder: folder }), { applied: 0, backupPath: null });
});

test('applyPending skips migrations another process applied after the pending list was read', async (t) => {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  const meta = (sql: string, folderMillis: number) => ({ sql: [sql], folderMillis, hash: crypto.createHash('sha256').update(sql).digest('hex'), bps: true });
  const m = meta('CREATE TABLE once_only (id integer)', 9_000_000_000_000);
  assert.equal(applyPending(db, [m], null), 1);
  assert.equal(applyPending(db, [m], null), 0, 'already applied: nothing runs, no "table already exists" error');
  assert.equal(db.inTransaction, false);
  assert.throws(() => applyPending(db, [{ ...m, hash: 'f'.repeat(64) }], null), (e: unknown) => e instanceof MigrationError && e.code === 'migration_changed');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('the strict-date migration refuses a database that already holds an impossible date', async (t) => {
  const dir = makeTempDir();
  t.after(() => removeTempDir(dir));
  // A database at 0000 only, holding a date the GLOB CHECK accepts but the calendar does not.
  const folder = migrationsFolder(dir);
  const journalPath = path.join(folder, 'meta/_journal.json');
  const full = fs.readFileSync(journalPath, 'utf8');
  const journal = JSON.parse(full);
  fs.writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }));
  const dbPath = path.join(dir, 'branch.db');
  const backupDir = path.join(dir, 'backups');
  await migrateDatabase({ dbPath, backupDir, migrationsFolder: folder });
  let db = openDatabase(dbPath);
  seedDemoData(db);
  db.prepare("UPDATE parcels SET arrival_date = '2026-02-30' WHERE id = 1").run();
  const before = snapshot(db);
  db.close();

  fs.writeFileSync(journalPath, full);
  await rejectsWith(migrateDatabase({ dbPath, backupDir, migrationsFolder: folder }), 'migration_failed');
  db = openDatabase(dbPath);
  t.after(() => db.close());
  assert.equal(migrationCount(db), 1);
  assert.deepEqual(snapshot(db), before);
  assert.equal((db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%_real_%'").get() as { n: number }).n, 0);
});

test('if the copy fails, nothing is migrated', async (t) => {
  const { folder, dbPath, before, dir } = await seededDb(t);
  migrationsFolder(dir, [{ tag: '0001_settings_note', sql: 'ALTER TABLE `settings` ADD `note` text;' }]);
  const notAFolder = path.join(dir, 'backups-is-a-file');
  fs.writeFileSync(notAFolder, 'x');
  await rejectsWith(migrateDatabase({ dbPath, backupDir: notAFolder, migrationsFolder: folder }), 'backup_failed');
  const db = openDatabase(dbPath);
  t.after(() => db.close());
  assert.equal(columns(db, 'settings').includes('note'), false);
  assert.equal(migrationCount(db), COMMITTED);
  assert.deepEqual(snapshot(db), before);
});

test('an applied migration that was changed or removed stops start-up', async (t) => {
  const { folder, dbPath, backupDir } = await seededDb(t);
  const file = path.join(folder, '0000_initial.sql');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, `${original}\n-- edited after it was applied\n`);
  await rejectsWith(migrateDatabase({ dbPath, backupDir, migrationsFolder: folder }), 'migration_changed');
  fs.writeFileSync(file, original);
  const journalPath = path.join(folder, 'meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  fs.writeFileSync(journalPath, JSON.stringify({ ...journal, entries: [] }));
  await rejectsWith(migrateDatabase({ dbPath, backupDir, migrationsFolder: folder }), 'migration_missing');
});

test('a pending migration older than an applied one is refused', async (t) => {
  const { dir, dbPath, backupDir } = await seededDb(t);
  const folder = migrationsFolder(dir, [{ tag: '0002_later', sql: 'CREATE TABLE `later` (`id` integer);', offset: 2000 }]);
  await migrateDatabase({ dbPath, backupDir, migrationsFolder: folder });
  migrationsFolder(dir, [
    { tag: '0002_later', sql: 'CREATE TABLE `later` (`id` integer);', offset: 2000 },
    { tag: '0001_earlier', sql: 'CREATE TABLE `earlier` (`id` integer);', offset: 1000 },
  ]);
  await rejectsWith(migrateDatabase({ dbPath, backupDir, migrationsFolder: folder }), 'migration_out_of_order');
});

test('the self-test refuses a database that is missing a table', async (t) => {
  const { folder, dbPath, backupDir } = await seededDb(t);
  const db = new Database(dbPath);
  db.exec('DROP TABLE worker_lease');
  db.close();
  await rejectsWith(migrateDatabase({ dbPath, backupDir, migrationsFolder: folder }), 'self_test_failed');
});

test('committed migrations match the checked-in hash list and the journal', () => {
  const listed = new Map(
    fs
      .readFileSync(path.join(MIGRATIONS_FOLDER, 'migrations.sha256'), 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const [hash, name] = l.split(/\s+/);
        return [name, hash] as const;
      }),
  );
  const files = fs.readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual([...listed.keys()].sort(), files, 'every migration file is listed, and nothing else');
  for (const f of files) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(MIGRATIONS_FOLDER, f))).digest('hex');
    assert.equal(hash, listed.get(f), `${f} was edited after it was committed; add a new migration instead`);
  }
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'));
  assert.deepEqual(journal.entries.map((e: { tag: string }) => `${e.tag}.sql`), files);
  assert.deepEqual(readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).map((m) => m.hash), files.map((f) => listed.get(f)));
});

test('isolation guards: no database in the project folder, test databases only under the temp folder', async (t) => {
  const inProject = path.join(PROJECT_ROOT, 'should-not-exist.db');
  assert.throws(() => openDatabase(inProject), /inside the project folder/);
  assert.equal(fs.existsSync(inProject), false);
  await assert.rejects(migrateDatabase({ dbPath: inProject, backupDir: os.tmpdir() }), /inside the project folder/);
  assert.equal(fs.existsSync(inProject), false);
  assert.throws(() => openDatabase('relative.db'), /must be absolute/);
  assert.throws(() => assertInTempDir(path.join(PROJECT_ROOT, 'x.db')), /must live under/);
  assert.throws(() => assertInTempDir(path.join(DEV_DATA_DIR, 'branch.db')), /must live under/);
  const dir = makeTempDir();
  t.after(() => removeTempDir(dir));
  fs.symlinkSync(PROJECT_ROOT, path.join(dir, 'link-to-project'));
  assert.throws(() => openDatabase(path.join(dir, 'link-to-project', 'sneaky.db')), /inside the project folder/);
  assert.equal(fs.existsSync(path.join(PROJECT_ROOT, 'sneaky.db')), false);
});
