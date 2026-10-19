import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createUser } from '../auth/accounts.ts';
import type { Db } from '../db/connection.ts';
import { PROJECT_ROOT } from '../db/paths.ts';
import { decideReviewItem } from '../db/review-items.ts';
import { createTestDb, makeTempDir, removeTempDir } from '../db/test-db.ts';
import { confirmImport } from '../importer/store.ts';
import { checkDetectedFile, dismissDetectedFile, folderSettings, folderState, scanFolder, setFolderSettings } from './folder.ts';

const fixture = (name: string) => path.join(PROJECT_ROOT, 'test/fixtures', name);
const count = (db: Db, sql: string) => db.prepare(sql).pluck().get() as number;

async function setup(t: test.TestContext) {
  const { db, dir, cleanup } = await createTestDb();
  const folder = makeTempDir();
  t.after(() => {
    cleanup();
    removeTempDir(folder);
  });
  const admin = await createUser(db, 'admin', 'correct horse battery', 'cli');
  const staff = await createUser(db, 'staff', 'correct horse battery', 'cli');
  assert.ok(admin.ok && staff.ok);
  return { db, dataDir: dir, folder, adminId: admin.userId, staffId: staff.userId };
}

test('folder settings: off by default, admin only, and the folder must be usable', async (t) => {
  const { db, folder, adminId, staffId } = await setup(t);
  assert.equal(folderSettings(db).auto, false, 'automatic checking starts off (owner 2026-10-19)');
  const input = { path: folder, auto: true, intervalSeconds: 60 };
  assert.equal(setFolderSettings(db, staffId, input).ok, false, 'staff cannot change it');
  const missing = setFolderSettings(db, adminId, { ...input, path: path.join(folder, 'nope') });
  assert.ok(!missing.ok && /does not exist/.test(missing.message));
  assert.equal(setFolderSettings(db, adminId, { ...input, intervalSeconds: 7 }).ok, false, 'only the offered intervals');
  assert.deepEqual(setFolderSettings(db, adminId, input), { ok: true });
  assert.deepEqual(folderSettings(db), input);
  const audit = db.prepare("SELECT detail FROM audit_log WHERE action = 'settings.changed'").pluck().get() as string;
  assert.ok(!audit.includes(folder), 'the audit log keeps the change, not the path');
});

test('scan: records finished exports once, never imports, and sets aside files that are gone', async (t) => {
  const { db, dataDir, folder, adminId, staffId } = await setup(t);
  setFolderSettings(db, adminId, { path: folder, auto: false, intervalSeconds: 60 });
  assert.deepEqual(await scanFolder(db, 'manual', 0), { ok: true, message: null, found: 0, added: 0, writing: [], unreadable: [], tooLarge: [] });

  fs.copyFileSync(fixture('scan-record-mixed.xlsx'), path.join(folder, 'Scan_record.xlsx'));
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'not an export');
  fs.writeFileSync(path.join(folder, '~$Scan_record.xlsx'), 'Excel lock file');
  fs.writeFileSync(path.join(folder, 'empty.csv'), '');
  const first = await scanFolder(db, 'manual', 0, staffId);
  assert.equal(first.added, 1);
  assert.deepEqual(first.writing, ['empty.csv'], 'an empty file is still being written');
  assert.equal((await scanFolder(db, 'auto', 0)).added, 0, 'the same version is recorded once');
  assert.equal(count(db, 'SELECT count(*) FROM imports'), 0, 'a scan imports nothing');
  assert.equal(count(db, 'SELECT count(*) FROM parcels'), 0);

  const [file] = folderState(db).files;
  assert.equal(file.fileName, 'Scan_record.xlsx');
  assert.equal(file.state, 'waiting');

  // Review it, confirm it: the detected file becomes imported, and a renamed copy is recognised by its content.
  const opened = checkDetectedFile(db, dataDir, file.id, staffId);
  assert.ok(opened.ok);
  assert.deepEqual(checkDetectedFile(db, dataDir, file.id, staffId), opened, 'opening it again resumes the same review');
  assert.equal(db.prepare('SELECT source FROM imports WHERE id = ?').pluck().get(opened.importId), 'folder');
  for (const id of db.prepare('SELECT id FROM import_review_items WHERE import_id = ? AND blocking = 1').pluck().all(opened.importId) as number[]) {
    decideReviewItem(db, id, { resolution: 'left_out' }, staffId);
  }
  const done = confirmImport(db, dataDir, opened.importId, {
    arrivalBatchDate: '2026-10-10', dateChoice: { kind: 'single_scan_date' }, batchDateChosen: true, userId: staffId, now: new Date('2026-10-10T03:00:00Z'),
  });
  assert.ok(done.ok, JSON.stringify(done));
  assert.equal(db.prepare('SELECT state FROM detected_files WHERE id = ?').pluck().get(file.id), 'imported');
  fs.copyFileSync(fixture('scan-record-mixed.xlsx'), path.join(folder, 'copy.xlsx'));
  await scanFolder(db, 'manual', 0);
  assert.equal(folderState(db).files.find((f) => f.fileName === 'copy.xlsx')?.state, 'imported', 'same content, already imported');

  // A file removed or changed after it was found can no longer be reviewed in that version.
  fs.copyFileSync(fixture('scan-record-two-days.xlsx'), path.join(folder, 'later.xlsx'));
  await scanFolder(db, 'manual', 0);
  const later = folderState(db).files.find((f) => f.fileName === 'later.xlsx')!;
  fs.appendFileSync(path.join(folder, 'later.xlsx'), 'x');
  const changed = checkDetectedFile(db, dataDir, later.id, staffId);
  assert.ok(!changed.ok && changed.reason === 'changed');
  fs.rmSync(path.join(folder, 'later.xlsx'));
  fs.copyFileSync(fixture('scan-record-two-days.csv'), path.join(folder, 'dismiss-me.csv'));
  await scanFolder(db, 'manual', 0);
  const extra = folderState(db).files.find((f) => f.fileName === 'dismiss-me.csv')!;
  assert.equal(dismissDetectedFile(db, extra.id, staffId), true);
  await scanFolder(db, 'manual', 0);
  assert.equal(folderState(db).files.some((f) => f.fileName === 'dismiss-me.csv'), false, 'a dismissed file stays dismissed');
});

test('scan: an unusable folder is reported, not thrown', async (t) => {
  const { db, folder, adminId } = await setup(t);
  setFolderSettings(db, adminId, { path: folder, auto: true, intervalSeconds: 60 });
  fs.rmSync(folder, { recursive: true });
  const r = await scanFolder(db, 'auto', 0);
  assert.equal(r.ok, false);
  assert.match(r.message!, /does not exist/);
  assert.equal(folderState(db).lastScan?.ok, false);
});

test('scan: a file that grows while the scan waits is still being written, and is found on a later scan', async (t) => {
  const { db, folder, adminId } = await setup(t);
  setFolderSettings(db, adminId, { path: folder, auto: false, intervalSeconds: 60 });
  const file = path.join(folder, 'export.csv');
  fs.writeFileSync(file, 'scan order number,Send Outlet\n');
  const scanning = scanFolder(db, 'manual', 300);
  setTimeout(() => fs.appendFileSync(file, '1,Shopee SHPE\n'), 50);
  const r = await scanning;
  assert.deepEqual([r.added, r.writing], [0, ['export.csv']]);
  assert.equal((await scanFolder(db, 'manual', 0)).added, 1);
});
