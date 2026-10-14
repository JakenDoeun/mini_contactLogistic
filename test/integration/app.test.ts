// npm run test:integration — builds the app once in a temporary copy, then tests it through `next start`.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrateDatabase } from '../../src/server/db/migrate.ts';
import { buildCopy, REPO, startApp, tempDir } from './harness.ts';

let buildDir: string;
const cleanups: (() => void | Promise<void>)[] = [];

before(() => {
  buildDir = buildCopy();
  cleanups.push(() => fs.rmSync(buildDir, { recursive: true, force: true }));
});
after(async () => {
  for (const c of cleanups.reverse()) await c();
});

/** A fresh data folder (0700) with an optional database migrated to the first `upTo` committed migrations. */
async function dataFolder(upTo?: number) {
  const dir = tempDir('cb-it-data-');
  fs.chmodSync(dir, 0o700);
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (upTo !== undefined) {
    const all = readMigrationFiles({ migrationsFolder: path.join(REPO, 'drizzle') }).length;
    let migrationsFolder: string | undefined;
    if (upTo < all) {
      migrationsFolder = path.join(dir, 'm');
      fs.mkdirSync(path.join(migrationsFolder, 'meta'), { recursive: true });
      const journal = JSON.parse(fs.readFileSync(path.join(REPO, 'drizzle/meta/_journal.json'), 'utf8'));
      journal.entries = journal.entries.slice(0, upTo);
      for (const e of journal.entries) fs.copyFileSync(path.join(REPO, 'drizzle', `${e.tag}.sql`), path.join(migrationsFolder, `${e.tag}.sql`));
      fs.writeFileSync(path.join(migrationsFolder, 'meta/_journal.json'), JSON.stringify(journal));
    }
    await migrateDatabase({ dbPath: path.join(dir, 'branch.db'), backupDir: path.join(dir, 'backups'), migrationsFolder });
  }
  return dir;
}

async function app(dataDir: string) {
  const running = await startApp(buildDir, dataDir);
  cleanups.push(running.stop);
  return running;
}

const probe = async (url: string) => (await fetch(`${url}/api/it-probe`)).json() as Promise<Record<string, unknown>>;

test('server bundle: openVerifiedDatabase finds drizzle/ and accepts a current database', async () => {
  const dataDir = await dataFolder(Infinity);
  const { url } = await app(dataDir);
  const r = await probe(url);
  assert.equal(r.projectRoot, buildDir, 'PROJECT_ROOT is the app folder, not a bundle chunk folder');
  assert.equal(r.migrationsFolder, path.join(buildDir, 'drizzle'));
  assert.equal(r.ok, true, String(r.message));
  assert.equal(r.migrations, readMigrationFiles({ migrationsFolder: path.join(REPO, 'drizzle') }).length);
});

test('server bundle: a missing, stale or refused database is not used, and is left unchanged', async () => {
  const dataDir = await dataFolder();
  const { url } = await app(dataDir);
  const dbPath = path.join(dataDir, 'branch.db');

  let r = await probe(url);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'database_missing');
  assert.equal(fs.existsSync(dbPath), false, 'no empty database created by the app');

  // One migration behind the code, as after an update started without db:migrate.
  const stale = await dataFolder(1);
  fs.copyFileSync(path.join(stale, 'branch.db'), dbPath);
  const before = fs.readFileSync(dbPath);
  r = await probe(url);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'self_test_failed');
  assert.match(String(r.message), /1 of \d+ migrations applied/);
  assert.deepEqual(fs.readFileSync(dbPath), before, 'the stale database was not migrated or changed');
});
