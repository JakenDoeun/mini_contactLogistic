import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from './connection.ts';
import { migrateDatabase, MigrationError, openVerifiedDatabase } from './migrate.ts';
import { MIGRATIONS_FOLDER, PROJECT_ROOT } from './paths.ts';
import { makeTempDir, removeTempDir } from './test-db.ts';

/** Run scripts/start-with-db.ts with DATA_DIR set; the "app" it starts only writes a marker file. */
function start(dataDir: string, marker: string) {
  const app = [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`];
  return spawnSync(process.execPath, ['scripts/start-with-db.ts', ...app], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATA_DIR: dataDir },
    encoding: 'utf8',
  });
}

function tempDataDir(t: TestContext) {
  const dir = makeTempDir();
  t.after(() => removeTempDir(dir));
  return { dataDir: path.join(dir, 'data'), marker: path.join(dir, 'started.txt') };
}

test('start-up runs the command only after the database is migrated and self-tested', (t) => {
  const { dataDir, marker } = tempDataDir(t);
  const result = start(dataDir, marker);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'started');
  assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700, 'the data folder is created 0700');
  const db = new Database(path.join(dataDir, 'branch.db'), { readonly: true });
  assert.equal((db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'import_review_items'").get() as { n: number }).n, 1);
  db.close();
});

test('start-up is refused when an applied migration was changed', (t) => {
  const { dataDir, marker } = tempDataDir(t);
  assert.equal(start(dataDir, marker).status, 0);
  fs.rmSync(marker);
  const db = new Database(path.join(dataDir, 'branch.db'));
  db.prepare('UPDATE "__drizzle_migrations" SET hash = ?').run('0'.repeat(64));
  db.close();
  const result = start(dataDir, marker);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not starting.*migration_changed/s);
  assert.equal(fs.existsSync(marker), false, 'the app was not started');
});

test('start-up is refused when the self-test fails', (t) => {
  const { dataDir, marker } = tempDataDir(t);
  assert.equal(start(dataDir, marker).status, 0);
  fs.rmSync(marker);
  const db = new Database(path.join(dataDir, 'branch.db'));
  db.exec('DROP TABLE worker_lease');
  db.close();
  const result = start(dataDir, marker);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /self_test_failed/);
  assert.equal(fs.existsSync(marker), false);
});

test('start-up is refused when the data folder is readable by others or inside the project', (t) => {
  const { dataDir, marker } = tempDataDir(t);
  fs.mkdirSync(dataDir, { mode: 0o755 });
  fs.chmodSync(dataDir, 0o755);
  const open = start(dataDir, marker);
  assert.equal(open.status, 1);
  assert.match(open.stderr, /must be 0700/);
  const inProject = start(path.join(PROJECT_ROOT, 'data-should-not-exist'), marker);
  assert.equal(inProject.status, 1);
  assert.match(inProject.stderr, /inside the project folder/);
  assert.equal(fs.existsSync(path.join(PROJECT_ROOT, 'data-should-not-exist')), false);
  assert.equal(fs.existsSync(marker), false);
});

/** Run `npm run db:migrate`'s script directly with DATA_DIR set. */
const migrateCli = (dataDir: string) =>
  spawnSync(process.execPath, ['scripts/db-migrate.ts'], { cwd: PROJECT_ROOT, env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' });

test('db:migrate creates and migrates the database, then has nothing to do', (t) => {
  const { dataDir } = tempDataDir(t);
  const committed = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'drizzle/meta/_journal.json'), 'utf8')).entries.length;
  const first = migrateCli(dataDir);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, new RegExp(`Database ready in .*: ${committed} migration\\(s\\) applied\\.`));
  assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
  assert.equal(fs.existsSync(path.join(dataDir, 'backups')), false, 'a new, empty database is not copied');
  const second = migrateCli(dataDir);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /: 0 migration\(s\) applied\./);
  assert.doesNotMatch(second.stdout, /copy at/);
});

test('db:migrate exits 1 with the reason when the database or the folder is not safe', (t) => {
  const { dataDir } = tempDataDir(t);
  assert.equal(migrateCli(dataDir).status, 0);
  const db = new Database(path.join(dataDir, 'branch.db'));
  db.prepare('UPDATE "__drizzle_migrations" SET hash = ?').run('0'.repeat(64));
  db.close();
  const changed = migrateCli(dataDir);
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /Database migration failed: migration_changed/);

  const open = tempDataDir(t);
  fs.mkdirSync(open.dataDir, { mode: 0o750 });
  fs.chmodSync(open.dataDir, 0o750);
  const refused = migrateCli(open.dataDir);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /must be 0700/);
  assert.equal(fs.existsSync(path.join(open.dataDir, 'branch.db')), false, 'nothing is created in an unsafe folder');
});

test('every script that starts the app runs db:migrate first and stops if it fails (finding M1)', (t) => {
  const scripts = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>;
  for (const name of ['dev', 'dev:https', 'start', 'start:lan']) {
    assert.match(scripts[name], /^node scripts\/db-migrate\.ts && next (dev|start)\b/, name);
  }
  for (const [name, cmd] of Object.entries(scripts)) {
    if (/\bnext (dev|start)\b/.test(cmd)) assert.match(cmd, /^node scripts\/db-migrate\.ts && /, `${name} starts the app without the database check`);
  }
  // End to end: with an unsafe data folder, `npm run start` exits non-zero before Next.js is started.
  const { dataDir } = tempDataDir(t);
  fs.mkdirSync(dataDir, { mode: 0o755 });
  fs.chmodSync(dataDir, 0o755);
  const result = spawnSync('npm', ['run', 'start:lan'], { cwd: PROJECT_ROOT, env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Database migration failed: .*must be 0700/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Next\.js|Ready in/);
});

test('openVerifiedDatabase: only an existing, fully migrated database; never creates or changes one', async (t) => {
  const dir = makeTempDir();
  t.after(() => removeTempDir(dir));
  const missing = path.join(dir, 'missing.db');
  assert.throws(() => openVerifiedDatabase(missing), (e: unknown) => e instanceof MigrationError && e.code === 'database_missing');
  assert.equal(fs.existsSync(missing), false, 'no empty database is created');

  const empty = path.join(dir, 'empty.db');
  openDatabase(empty).close();
  assert.throws(() => openVerifiedDatabase(empty), (e: unknown) => e instanceof MigrationError && e.code === 'self_test_failed');
  const e = new Database(empty, { readonly: true });
  assert.equal((e.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n, 0, 'nothing was migrated');
  e.close();

  // A database one migration behind the code (as after an update started without db:migrate) is refused unchanged.
  const folder = path.join(dir, 'm');
  fs.mkdirSync(path.join(folder, 'meta'), { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'));
  fs.copyFileSync(path.join(MIGRATIONS_FOLDER, '0000_initial.sql'), path.join(folder, '0000_initial.sql'));
  fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }));
  const stale = path.join(dir, 'stale.db');
  await migrateDatabase({ dbPath: stale, backupDir: path.join(dir, 'backups'), migrationsFolder: folder });
  const schemaOf = (p: string) => {
    const d = new Database(p, { readonly: true });
    const s = d.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all();
    const m = d.prepare('SELECT * FROM "__drizzle_migrations"').all();
    d.close();
    return { s, m };
  };
  const before = schemaOf(stale);
  assert.throws(() => openVerifiedDatabase(stale), /self_test_failed: 1 of \d+ migrations applied/);
  assert.deepEqual(schemaOf(stale), before);

  const current = path.join(dir, 'current.db');
  await migrateDatabase({ dbPath: current, backupDir: path.join(dir, 'backups') });
  const db = openVerifiedDatabase(current);
  t.after(() => db.close());
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
});

test('the demo seed refuses the production data folder before touching it', () => {
  const result = spawnSync(process.execPath, ['scripts/db-seed.ts'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATA_DIR: '/var/lib/campus-branch' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to seed demo data/);
});
