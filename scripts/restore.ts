// npm run restore            list the backups, newest first
// npm run restore -- <n>     put backup number <n> back. Campus Branch must be stopped first.
// Before replacing anything, the current database is saved as a before-restore copy. After the restore the database is
// migrated if the copy is older, and expired data is deleted before the app can open it (plan Revision 4).
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { writeAudit } from '../src/server/db/audit.ts';
import { listBackups, SERVE_PID_FILE, stamp, writeCopy, backupDirOf } from '../src/server/db/backup.ts';
import { openDatabase } from '../src/server/db/connection.ts';
import { openVerifiedDatabase, prepareDatabase } from '../src/server/db/migrate.ts';
import { resolveDataDir } from '../src/server/db/paths.ts';
import { purgeExpired } from '../src/server/db/retention.ts';
import { holdAfterRestore } from '../src/server/sms/queue.ts';

const fail = (message: string): never => {
  console.error(`restore: ${message}`);
  process.exit(1);
};
const cambodiaTime = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
const running = (pidFile: string) => {
  try {
    process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // alive, but another account's process
  }
};

const dataDir = resolveDataDir();
const backups = listBackups(dataDir);
const arg = process.argv[2];
if (arg === undefined) {
  if (!backups.length) fail('no backups found');
  console.log('Backups (Cambodia time), newest first:');
  backups.forEach((b, i) => console.log(`  ${String(i + 1).padStart(2)}  ${cambodiaTime(b.at)}  ${b.kind}  (${Math.ceil(fs.statSync(b.path).size / 1024)} KB)`));
  console.log('To restore one: npm run restore -- <number>');
  process.exit(0);
}
const chosen = /^\d+$/.test(arg) ? backups[Number(arg) - 1] : undefined;
if (!chosen) fail(`no backup number ${arg}; run npm run restore to list them`);
if (running(path.join(dataDir, SERVE_PID_FILE))) fail('Campus Branch is running. Stop it first, then run this again.');

const check = new Database(chosen!.path, { readonly: true, fileMustExist: true });
const ok = check.pragma('integrity_check', { simple: true }) === 'ok';
check.close();
if (!ok) fail(`${chosen!.file} is damaged; choose another backup`);

const dbPath = path.join(dataDir, 'branch.db');
if (fs.existsSync(dbPath)) {
  const keep = path.join(backupDirOf(dataDir), `before-restore-${stamp(new Date())}.db`);
  try {
    const current = openDatabase(dbPath, { mustExist: true });
    try {
      writeCopy(current, keep);
    } finally {
      current.close();
    }
  } catch (e) {
    fail(`could not save the current database first (${(e as Error).message}); nothing was changed`);
  }
  console.log(`Current database saved as ${path.basename(keep)}`);
}

const tmp = `${dbPath}.restore.tmp`;
fs.copyFileSync(chosen!.path, tmp);
fs.chmodSync(tmp, 0o600);
const fd = fs.openSync(tmp, 'r+');
fs.fsyncSync(fd);
fs.closeSync(fd);
for (const extra of ['-wal', '-shm']) fs.rmSync(`${dbPath}${extra}`, { force: true });
fs.renameSync(tmp, dbPath);

try {
  await prepareDatabase(dataDir);
  const db = openVerifiedDatabase(dbPath);
  try {
    const purged = purgeExpired(db, dataDir);
    holdAfterRestore(db, chosen!.at);
    writeAudit(db, { action: 'backup.restored', entity: 'backup', entityIds: [], outcome: 'ok', detail: { file_name: chosen!.file, count: purged.total } });
    const parcels = (db.prepare('SELECT count(*) AS n FROM parcels').get() as { n: number }).n;
    console.log(`Restored ${chosen!.file} (${cambodiaTime(chosen!.at)}): ${parcels} parcel(s); ${purged.total} expired row(s) removed. Start Campus Branch again.`);
    console.log('SMS sending is on hold: on the Notifications page, staff check the gateway phone and confirm before anything is sent.');
  } finally {
    db.close();
  }
} catch (e) {
  fail(`the restored database did not pass the start-up checks (${(e as Error).message}); the previous one is in the before-restore copy`);
}
