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

// A Windows scheduled task cannot set environment variables or show a console, so the folder, port, branch address
// and a log file may also come as arguments. The address matters on Windows: Tailscale shows its status only to the
// user who signed it in, so the app's own account cannot find its name there.
let logFile = '';
const ENV = { 'data-dir': 'DATA_DIR', port: 'PORT', 'branch-url': 'BRANCH_URL' } as const;
for (const arg of process.argv.slice(2)) {
  const m = /^--(data-dir|port|branch-url|log)=(.+)$/.exec(arg);
  if (!m) {
    console.error(`Unknown argument ${arg}. Usage: node scripts/serve.ts [--data-dir=<folder>] [--port=<port>] [--branch-url=https://<name>] [--log=<file>]`);
    process.exit(2);
  }
  if (m[1] === 'log') logFile = path.resolve(m[2]);
  else process.env[ENV[m[1] as keyof typeof ENV]] = m[2];
}
const PORT = process.env.PORT || '3000';
let logFd: number | null = null;
if (logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  // Keep one older file once the log passes 5 MB.
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5_000_000) fs.renameSync(logFile, `${logFile}.old`);
  logFd = fs.openSync(logFile, 'a');
}
const log = (line: string) => {
  const text = `[serve ${new Date().toISOString()}] ${line}`;
  if (logFd === null) console.log(text);
  else fs.writeSync(logFd, `${text}\n`);
};

let dataDir = '';
try {
  dataDir = resolveDataDir();
  await prepareDatabase(dataDir);
} catch (e) {
  log(`Database check failed; not starting: ${(e as Error).message}`);
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
// If this launcher is killed outright (Windows "End task", Stop-ScheduledTask, kill -9), the web app would keep the port
// and the database open; it checks every 2 s that the launcher is alive and exits when it is not.
const exitWithParent = `data:text/javascript,${encodeURIComponent(
  'const p=process.ppid;setInterval(()=>{try{process.kill(p,0)}catch{process.exit(0)}},2000).unref()',
)}`;
let child: ChildProcess | null = null;
let stopping = false;
let delay = 5_000;
function startApp() {
  const startedAt = Date.now();
  child = spawn(process.execPath, ['--import', exitWithParent, nextBin, 'start', '-H', '127.0.0.1', '-p', PORT], {
    stdio: logFd === null ? 'inherit' : ['ignore', logFd, logFd],
    env: { ...process.env, DATA_DIR: dataDir },
  });
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
