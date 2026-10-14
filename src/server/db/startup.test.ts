import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PROJECT_ROOT } from './paths.ts';
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

test('the demo seed refuses the production data folder before touching it', () => {
  const result = spawnSync(process.execPath, ['scripts/db-seed.ts'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATA_DIR: '/var/lib/campus-branch' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to seed demo data/);
});
