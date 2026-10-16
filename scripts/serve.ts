// npm run serve — the production launcher (plan Revision 4), started at boot by Windows Task Scheduler or systemd
// (deploy/). It migrates and self-tests the database, deletes expired data, saves a backup, then runs `next start` on
// 127.0.0.1 and restarts it after a crash. While running: a backup 5 minutes after changes (at most every 15 minutes)
// and the retention job every hour. Stopped with Ctrl+C or a service stop, it saves a backup before exiting.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { backupScheduler, saveBackup, SERVE_PID_FILE } from '../src/server/db/backup.ts';
import { openVerifiedDatabase, prepareDatabase } from '../src/server/db/migrate.ts';
import { resolveDataDir } from '../src/server/db/paths.ts';
import { purgeExpired } from '../src/server/db/retention.ts';

// A Windows scheduled task cannot set environment variables, so the folder and port may also come as arguments.
for (const arg of process.argv.slice(2)) {
  const m = /^--(data-dir|port)=(.+)$/.exec(arg);
  if (!m) {
    console.error(`Unknown argument ${arg}. Usage: node scripts/serve.ts [--data-dir=<folder>] [--port=<port>]`);
    process.exit(2);
  }
  process.env[m[1] === 'port' ? 'PORT' : 'DATA_DIR'] = m[2];
}
const PORT = process.env.PORT || '3000';
const log = (line: string) => console.log(`[serve ${new Date().toISOString()}] ${line}`);

const dataDir = resolveDataDir();
try {
  await prepareDatabase(dataDir);
} catch (e) {
  console.error(`Database check failed; not starting: ${(e as Error).message}`);
  process.exit(1);
}
const db = openVerifiedDatabase(path.join(dataDir, 'branch.db'));
const pidFile = path.join(dataDir, SERVE_PID_FILE);
fs.writeFileSync(pidFile, String(process.pid), { mode: 0o600 });

const backups = backupScheduler(db, dataDir, log);
function retention() {
  try {
    const r = purgeExpired(db, dataDir);
    if (r.total) {
      log(`Retention: deleted ${r.total} row(s) up to ${r.cutoff}`);
      backups.markChanged();
    }
  } catch (e) {
    log(`Retention failed: ${(e as Error).message}`);
  }
}
function backupNow(reason: string) {
  try {
    const r = saveBackup(db, dataDir);
    log(r.saved ? `Backup saved (${reason}): ${path.basename(r.path)}` : `Backup up to date (${reason})`);
  } catch (e) {
    log(`Backup failed (${reason}): ${(e as Error).message}`);
  }
}
retention();
backupNow('start');
const timers = [setInterval(() => backups.tick(), 60_000), setInterval(retention, 3600_000)];

// ---- the web app, restarted after a crash (5 s, doubling to 60 s; reset after a minute of running) ----
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
let child: ChildProcess | null = null;
let stopping = false;
let delay = 5_000;
function startApp() {
  const startedAt = Date.now();
  child = spawn(process.execPath, [nextBin, 'start', '-H', '127.0.0.1', '-p', PORT], { stdio: 'inherit', env: { ...process.env, DATA_DIR: dataDir } });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return;
    if (Date.now() - startedAt > 60_000) delay = 5_000;
    log(`Web app stopped (${signal ?? `exit ${code}`}); restarting in ${delay / 1000} s`);
    setTimeout(startApp, delay);
    delay = Math.min(delay * 2, 60_000);
  });
}
startApp();

function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`${signal}: stopping`);
  timers.forEach(clearInterval);
  const finish = () => {
    backupNow('stop');
    db.close();
    fs.rmSync(pidFile, { force: true });
    process.exit(0);
  };
  if (!child) return finish();
  child.once('exit', finish);
  child.kill('SIGTERM');
  setTimeout(() => child?.kill('SIGKILL'), 10_000).unref();
}
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(s, () => stop(s));
