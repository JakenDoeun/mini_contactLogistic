import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { listBackups, saveBackup } from './backup.ts';
import { openDatabase } from './connection.ts';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { applyPending, migrateDatabase, MigrationError, openVerifiedDatabase } from './migrate.ts';
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
  for (const name of ['dev', 'dev:https']) assert.match(scripts[name], /^node scripts\/db-migrate\.ts && next dev\b/, name);
  // start and start:lan run the launcher, which migrates and self-tests first and passes DATA_DIR on (finding M2).
  for (const name of ['start', 'start:lan', 'serve']) assert.equal(scripts[name], 'node scripts/serve.ts', name);
  for (const [name, cmd] of Object.entries(scripts)) {
    if (/\bnext (dev|start)\b/.test(cmd)) assert.match(cmd, /^node scripts\/db-migrate\.ts && /, `${name} starts the app without the database check`);
  }
  // End to end: with an unsafe data folder, `npm run start` exits non-zero before Next.js is started.
  const { dataDir } = tempDataDir(t);
  fs.mkdirSync(dataDir, { mode: 0o755 });
  fs.chmodSync(dataDir, 0o755);
  const result = spawnSync('npm', ['run', 'start:lan'], { cwd: PROJECT_ROOT, env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /Database check failed; not starting: .*must be 0700/);
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
  // applyPending, not migrateDatabase: the self-test would refuse a database without the later tables.
  const staleDb = openDatabase(stale);
  applyPending(staleDb, readMigrationFiles({ migrationsFolder: folder }), null);
  staleDb.close();
  const schemaOf = (p: string) => {
    const d = new Database(p, { readonly: true });
    const s = d.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all();
    const m = d.prepare('SELECT * FROM "__drizzle_migrations"').all();
    d.close();
    return { s, m };
  };
  const before = schemaOf(stale);
  assert.throws(() => openVerifiedDatabase(stale), /self_test_failed: missing tables: recovery_codes/);
  assert.deepEqual(schemaOf(stale), before);

  const current = path.join(dir, 'current.db');
  await migrateDatabase({ dbPath: current, backupDir: path.join(dir, 'backups') });
  const db = openVerifiedDatabase(current);
  t.after(() => db.close());
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
});

test('user CLI: adds an account with a one-time printed password, refuses duplicates, disables and ends sessions', async (t) => {
  const { dataDir } = tempDataDir(t);
  const user = (...args: string[]) =>
    spawnSync(process.execPath, ['scripts/user.ts', ...args], { cwd: PROJECT_ROOT, env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' });
  assert.equal(user('add', 'staff.two').status, 1, 'no database yet: refused, nothing created');
  assert.equal(fs.existsSync(path.join(dataDir, 'branch.db')), false);
  assert.equal(migrateCli(dataDir).status, 0);
  const added = user('add', 'Staff.Two');
  assert.equal(added.status, 0, added.stderr);
  const password = added.stdout.trim().split('\n').at(-1)!;
  assert.match(password, /^[A-Za-z0-9_-]{20}$/);
  assert.equal(user('add', 'staff.two').status, 1);
  assert.equal(user('bogus', 'x').status, 2);
  const db = new Database(path.join(dataDir, 'branch.db'));
  const row = db.prepare("SELECT id, password_hash FROM users WHERE username = 'staff.two'").get() as { id: number; password_hash: string };
  assert.equal(row.password_hash.includes(password), false);
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES ('h', ?, 'a', 'b', 'c')").run(row.id);
  db.close();
  const disabled = user('disable', 'staff.two');
  assert.equal(disabled.status, 0, disabled.stderr);
  const db2 = new Database(path.join(dataDir, 'branch.db'), { readonly: true });
  assert.deepEqual(db2.prepare('SELECT disabled FROM users WHERE id = ?').get(row.id), { disabled: 1 });
  assert.equal((db2.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }).n, 0);
  assert.equal(JSON.stringify(db2.prepare('SELECT * FROM audit_log').all()).includes(password), false);
  db2.close();
  assert.equal(user('disable', 'staff.two').status, 1, 'already disabled');
});

test('first-run-code: shows an existing code in a terminal only, never creates or replaces one, refuses once setup is done', async (t) => {
  const { dataDir } = tempDataDir(t);
  const env = { ...process.env, DATA_DIR: dataDir };
  const piped = () => spawnSync(process.execPath, ['scripts/first-run-code.ts'], { cwd: PROJECT_ROOT, env, encoding: 'utf8' });
  // `script` gives the command a real terminal, as when the owner runs it by hand.
  const inTerminal = () =>
    spawnSync('script', ['-qec', `${JSON.stringify(process.execPath)} scripts/first-run-code.ts`, '/dev/null'], { cwd: PROJECT_ROOT, env, encoding: 'utf8' });
  const file = path.join(dataDir, 'first-run-code.txt');

  assert.equal(inTerminal().status, 1, 'no database yet');
  assert.equal(migrateCli(dataDir).status, 0);
  const refusedPipe = piped();
  assert.equal(refusedPipe.status, 1);
  assert.match(refusedPipe.stderr, /Refusing to print the one-time code into a pipe or a file/);
  assert.equal(fs.existsSync(file), false, 'nothing created when refused');

  // No code file yet: the command refuses and does not create a setup credential of its own.
  const missing = inTerminal();
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /No one-time code exists yet/);
  assert.equal(fs.existsSync(file), false, 'the command never creates a code');
  // The sign-in page creates the code (ensureFirstRunCode); from then on the command shows it.
  const { ensureFirstRunCode } = await import('../auth/accounts.ts');
  const { openVerifiedDatabase: openForPage } = await import('./migrate.ts');
  const pageDb = openForPage(path.join(dataDir, 'branch.db'));
  ensureFirstRunCode(pageDb, dataDir);
  pageDb.close();
  const first = inTerminal();
  assert.equal(first.status, 0, first.stdout);
  const code = fs.readFileSync(file, 'utf8').trim();
  assert.match(code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.ok(first.stdout.includes(code), 'the code is shown');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const again = inTerminal();
  assert.ok(again.stdout.includes(code), 'same code the second time: never regenerated');
  assert.equal(fs.readFileSync(file, 'utf8').trim(), code);

  // Setup completed with that code: the command refuses and the code no longer works.
  const { openVerifiedDatabase } = await import('./migrate.ts');
  const { createFirstAccount } = await import('../auth/accounts.ts');
  const db = openVerifiedDatabase(path.join(dataDir, 'branch.db'));
  t.after(() => db.close());
  assert.ok((await createFirstAccount(db, dataDir, code, 'first.staff', 'correct horse battery')).ok);
  const done = inTerminal();
  assert.equal(done.status, 1);
  assert.match(done.stdout, /setup is complete/);
  assert.equal(done.stdout.includes(code), false);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(await createFirstAccount(db, dataDir, code, 'second.staff', 'correct horse battery'), { ok: false, reason: 'exists' });
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM audit_log').all()).includes(code), false, 'never logged');
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

test('recovery-code CLI: show only in a terminal and never creates; rotate replaces; revoke ends; nothing is logged', async (t) => {
  const { dataDir } = tempDataDir(t);
  const env = { ...process.env, DATA_DIR: dataDir };
  const piped = (cmd: string) => spawnSync(process.execPath, ['scripts/recovery-code.ts', cmd], { cwd: PROJECT_ROOT, env, encoding: 'utf8' });
  const inTerminal = (cmd: string) =>
    spawnSync('script', ['-qec', `${JSON.stringify(process.execPath)} scripts/recovery-code.ts ${cmd}`, '/dev/null'], { cwd: PROJECT_ROOT, env, encoding: 'utf8' });
  const file = path.join(dataDir, 'recovery-code.txt');
  const CODE = /[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}/;

  assert.equal(migrateCli(dataDir).status, 0);
  assert.equal(piped('bogus').status, 2);
  const none = inTerminal('show');
  assert.equal(none.status, 1);
  assert.match(none.stdout, /no active recovery code/);
  assert.equal(fs.existsSync(file), false, 'show never creates a code');

  const rotated = piped('rotate');
  assert.equal(rotated.status, 0, rotated.stderr);
  assert.doesNotMatch(rotated.stdout, CODE, 'rotate does not print the code');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.match(piped('show').stderr, /Refusing to print the recovery code into a pipe/);
  const first = inTerminal('show').stdout.match(CODE)?.[0];
  assert.equal(first, fs.readFileSync(file, 'utf8').trim());

  assert.equal(piped('rotate').status, 0);
  const second = inTerminal('show').stdout.match(CODE)?.[0];
  assert.ok(second && second !== first, 'rotate made a new code');

  fs.rmSync(file);
  const missing = inTerminal('show');
  assert.match(missing.stdout, /its file is missing/);
  assert.equal(fs.existsSync(file), false, 'a missing file is never regenerated by show');

  assert.match(piped('revoke').stdout, /Recovery code revoked/);
  assert.match(piped('revoke').stdout, /no active recovery code/);
  const db = new Database(path.join(dataDir, 'branch.db'), { readonly: true });
  t.after(() => db.close());
  const everything = JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
  for (const code of [first!, second!]) assert.equal(everything.includes(code.replace(/-/g, '').slice(0, 8)), false);
  assert.deepEqual(
    (db.prepare('SELECT end_reason FROM recovery_codes ORDER BY id').all() as { end_reason: string }[]).map((r) => r.end_reason),
    ['rotated', 'revoked'],
  );
});

test('restore CLI: lists backups; refuses while serve runs; saves the current database first, then puts the chosen one back', (t) => {
  const { dataDir } = tempDataDir(t);
  const restore = (...args: string[]) =>
    spawnSync(process.execPath, ['scripts/restore.ts', ...args], { cwd: PROJECT_ROOT, env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' });
  assert.equal(migrateCli(dataDir).status, 0);
  const dbPath = path.join(dataDir, 'branch.db');
  const value = () => {
    const db = openDatabase(dbPath, { readonly: true });
    const row = db.prepare("SELECT value FROM settings WHERE key = 'it.v'").get() as { value: string } | undefined;
    db.close();
    return row?.value;
  };
  const db = openDatabase(dbPath);
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('it.v', '1', ?)").run(new Date().toISOString());
  saveBackup(db, dataDir);
  db.prepare("UPDATE settings SET value = '2' WHERE key = 'it.v'").run();
  db.close();

  const list = restore();
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, / 1 {2}\d{4}-\d{2}-\d{2} \d{2}:\d{2} {2}backup/);
  assert.equal(restore('9').status, 1);
  fs.writeFileSync(path.join(dataDir, 'serve.pid'), String(process.pid));
  const refused = restore('1');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /running. Stop it first/);
  assert.equal(value(), '2', 'nothing changed');
  fs.rmSync(path.join(dataDir, 'serve.pid'));

  const done = restore('1');
  assert.equal(done.status, 0, done.stderr);
  assert.equal(value(), '1', 'the backup is back');
  const saved = listBackups(dataDir).find((b) => b.kind === 'before-restore');
  assert.ok(saved, 'the database from before the restore was kept');
  const before = openDatabase(saved.path, { readonly: true });
  assert.equal((before.prepare("SELECT value FROM settings WHERE key = 'it.v'").get() as { value: string }).value, '2');
  before.close();
  const audit = openDatabase(dbPath, { readonly: true });
  assert.ok(audit.prepare("SELECT 1 FROM audit_log WHERE action = 'backup.restored'").get());
  audit.close();
});
