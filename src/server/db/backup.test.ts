import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { BACKUP_KEEP_MS, backupDirOf, backupScheduler, backupStatus, listBackups, pruneBackups, saveBackup, writeCopy } from './backup.ts';
import { openDatabase } from './connection.ts';
import { createTestDb } from './test-db.ts';

const T0 = new Date('2026-10-17T03:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

test('saveBackup: a checked 0600 copy in a 0700 folder; no new copy while nothing changed', async (t) => {
  const { db, dir, cleanup } = await createTestDb();
  t.after(cleanup);
  const first = saveBackup(db, dir, T0);
  assert.equal(first.saved, true);
  assert.ok(first.saved && fs.existsSync(first.path));
  assert.equal(fs.statSync(backupDirOf(dir)).mode & 0o777, 0o700);
  if (first.saved) assert.equal(fs.statSync(first.path).mode & 0o777, 0o600);
  const copy = new Database(first.saved ? first.path : '', { readonly: true });
  assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(copy.pragma('journal_mode', { simple: true }), 'delete', 'one self-contained file');
  copy.close();

  assert.deepEqual(saveBackup(db, dir, later(MIN)), { saved: false, reason: 'unchanged', at: T0 });
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('x', '1', ?)").run(T0.toISOString());
  assert.equal(saveBackup(db, dir, later(2 * MIN)).saved, true);
  assert.equal(listBackups(dir).length, 2);
  assert.deepEqual(backupStatus(dir), { lastBackupAt: later(2 * MIN).toISOString(), failing: false });
});

test('pruneBackups: copies older than 3 days go, the newest always stays, stale temporary files go (finding I6)', async (t) => {
  const { db, dir, cleanup } = await createTestDb();
  t.after(cleanup);
  for (const name of ['pre-migration-2026-10-10T00-00-00-000Z.db', 'backup-2026-10-17T03-00-00-000Z.db', 'backup-2026-10-17T03-01-00-000Z.db']) {
    writeCopy(db, path.join(backupDirOf(dir), name));
  }
  const stale = path.join(backupDirOf(dir), 'backup-2026-10-17T03-05-00-000Z.db.0123456789ab.tmp');
  fs.writeFileSync(stale, 'partial');
  fs.utimesSync(stale, later(-20 * MIN), later(-20 * MIN));
  assert.equal(listBackups(dir).length, 3);

  assert.equal(pruneBackups(dir, later(MIN)), 2, 'the 7-day-old copy and the stale temporary file');
  assert.equal(pruneBackups(dir, later(BACKUP_KEEP_MS + 2 * MIN)), 1);
  assert.deepEqual(listBackups(dir).map((b) => b.at), [later(MIN)], 'the newest copy is kept even when it is old');
});

test('saveBackup: two failures in a row turn the status red; a success clears it', async (t) => {
  const { db, dir, cleanup } = await createTestDb();
  t.after(cleanup);
  fs.writeFileSync(backupDirOf(dir), 'not a folder');
  assert.throws(() => saveBackup(db, dir, T0));
  assert.equal(backupStatus(dir).failing, false, 'one failure is not shown');
  assert.throws(() => saveBackup(db, dir, later(MIN)));
  assert.equal(backupStatus(dir).failing, true);
  fs.rmSync(backupDirOf(dir));
  saveBackup(db, dir, later(2 * MIN));
  assert.equal(backupStatus(dir).failing, false);
});

test('a copy taken while another connection writes is consistent', async (t) => {
  const { db, dir, dbPath, cleanup } = await createTestDb();
  t.after(cleanup);
  const writer = openDatabase(dbPath);
  t.after(() => writer.close());
  const insert = writer.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
  writer.transaction(() => {
    for (let i = 0; i < 200; i++) insert.run(`k${i}`, String(i), T0.toISOString());
  })();
  writer.exec('BEGIN IMMEDIATE');
  insert.run('uncommitted', '1', T0.toISOString());
  const r = saveBackup(db, dir, T0);
  writer.exec('ROLLBACK');
  assert.ok(r.saved);
  const copy = new Database(r.path, { readonly: true });
  assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal((copy.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'k%'").get() as { n: number }).n, 200, 'every committed row');
  assert.equal(copy.prepare("SELECT 1 FROM settings WHERE key = 'uncommitted'").get(), undefined, 'nothing uncommitted');
  copy.close();
});

test('scheduler: a copy 5 minutes after the web app last wrote, at most every 15 minutes, none without changes', async (t) => {
  const { db, dir, dbPath, cleanup } = await createTestDb();
  t.after(cleanup);
  const web = openDatabase(dbPath); // the web app's connection
  t.after(() => web.close());
  const lines: string[] = [];
  const s = backupScheduler(db, dir, (l) => lines.push(l));
  const write = (k: string) => web.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, '1', ?)").run(k, T0.toISOString());

  s.tick(T0);
  assert.equal(listBackups(dir).length, 0, 'no change yet');
  write('a');
  s.tick(later(MIN));
  s.tick(later(5 * MIN));
  assert.equal(listBackups(dir).length, 0, 'still within 5 minutes of the change');
  s.tick(later(6 * MIN));
  assert.equal(listBackups(dir).length, 1);
  write('b');
  s.tick(later(7 * MIN));
  s.tick(later(20 * MIN));
  assert.equal(listBackups(dir).length, 1, 'not again within 15 minutes');
  s.tick(later(21 * MIN));
  assert.equal(listBackups(dir).length, 2);
  s.tick(later(60 * MIN));
  assert.equal(listBackups(dir).length, 2, 'nothing changed since');
  s.markChanged(later(61 * MIN));
  s.tick(later(70 * MIN));
  assert.equal(lines.at(-1), 'Backup skipped: no change since the last one', 'a reported change that left the data the same saves nothing');
});
