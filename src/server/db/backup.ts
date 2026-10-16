// Local safety copies (plan Revision 4): the laptop only, no off-machine copy, kept 3 days. Each copy is one consistent
// VACUUM INTO snapshot (deleted rows are left behind), written to a temporary name and renamed only after it passes
// integrity_check, so a power cut can leave at most a temporary file, which pruning removes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Db } from './connection.ts';

export const BACKUP_KEEP_MS = 3 * 24 * 3600_000;
export const BACKUP_QUIET_MS = 5 * 60_000; // a copy follows 5 minutes after the last change…
export const BACKUP_MIN_GAP_MS = 15 * 60_000; // …and at most one every 15 minutes
const TEMP_STALE_MS = 10 * 60_000; // a temporary file this old belongs to a run that stopped
const STATUS_FILE = 'backup-status.json';
export const SERVE_PID_FILE = 'serve.pid'; // written by scripts/serve.ts; scripts/restore.ts refuses while it is alive

export type BackupKind = 'backup' | 'pre-migration' | 'before-restore';
const NAME = /^(backup|pre-migration|before-restore)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/;
const TEMP = /\.db\.[0-9a-f]{12}\.tmp$/;

export const backupDirOf = (dataDir: string) => path.join(dataDir, 'backups');
const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, '-');
/** File names in the backups folder; none when it is missing or not a folder (status must not throw then). */
const namesIn = (dir: string) => (fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() ? fs.readdirSync(dir) : []);

/** Writes a checked copy of the open database to `dest` (mode 0600). Throws, leaving no file at `dest`, on any failure. */
export function writeCopy(db: Db, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  const tmp = `${dest}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    db.prepare('VACUUM INTO ?').run(tmp);
    fs.chmodSync(tmp, 0o600);
    const copy = new Database(tmp, { fileMustExist: true });
    try {
      const result = copy.pragma('integrity_check', { simple: true });
      if (result !== 'ok') throw new Error(`integrity_check on the copy returned ${String(result)}`);
    } finally {
      copy.close();
    }
    const fd = fs.openSync(tmp, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, dest);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

export interface BackupFile {
  file: string;
  path: string;
  kind: BackupKind;
  at: Date;
}

/** The copies in the backups folder, newest first. */
export function listBackups(dataDir: string): BackupFile[] {
  const dir = backupDirOf(dataDir);
  return namesIn(dir)
    .flatMap((file) => {
      const m = NAME.exec(file);
      if (!m) return [];
      const at = new Date(`${m[2]}T${m[3]}:${m[4]}:${m[5]}.${m[6]}Z`);
      return Number.isNaN(at.getTime()) ? [] : [{ file, path: path.join(dir, file), kind: m[1] as BackupKind, at }];
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

const sha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * Removes copies older than 3 days (always keeping the newest one) and temporary files left by a stopped run,
 * including a partial pre-migration copy (finding I6). Returns how many files it removed.
 */
export function pruneBackups(dataDir: string, now = new Date()): number {
  const dir = backupDirOf(dataDir);
  let removed = 0;
  for (const b of listBackups(dataDir).slice(1)) {
    if (now.getTime() - b.at.getTime() > BACKUP_KEEP_MS) {
      fs.rmSync(b.path, { force: true });
      removed++;
    }
  }
  for (const file of namesIn(dir)) {
    if (!TEMP.test(file)) continue;
    const p = path.join(dir, file);
    if (now.getTime() - fs.statSync(p).mtimeMs > TEMP_STALE_MS) {
      fs.rmSync(p, { force: true });
      removed++;
    }
  }
  return removed;
}

export type SaveResult = { saved: true; path: string; at: Date } | { saved: false; reason: 'unchanged'; at: Date };

/**
 * Saves a copy unless it is byte-for-byte the newest one (VACUUM INTO of unchanged data gives identical bytes), then
 * prunes. Records the outcome in the status file read by Settings. Throws on failure, after recording it.
 */
export function saveBackup(db: Db, dataDir: string, now = new Date(), kind: BackupKind = 'backup'): SaveResult {
  try {
    const dest = path.join(backupDirOf(dataDir), `${kind}-${stamp(now)}.db`);
    const newest = listBackups(dataDir)[0];
    writeCopy(db, dest);
    let result: SaveResult = { saved: true, path: dest, at: now };
    if (kind === 'backup' && newest && sha256(newest.path) === sha256(dest)) {
      fs.rmSync(dest);
      result = { saved: false, reason: 'unchanged', at: newest.at };
    }
    pruneBackups(dataDir, now);
    writeStatus(dataDir, { lastOkAt: now.toISOString(), failures: 0, lastError: null });
    return result;
  } catch (e) {
    const previous = readStatus(dataDir);
    writeStatus(dataDir, { ...previous, failures: previous.failures + 1, lastError: (e as Error).message.slice(0, 300) });
    throw e;
  }
}

interface StatusFile {
  lastOkAt: string | null;
  failures: number;
  lastError: string | null;
}

function readStatus(dataDir: string): StatusFile {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dataDir, STATUS_FILE), 'utf8')) as StatusFile;
    return { lastOkAt: s.lastOkAt ?? null, failures: Number(s.failures) || 0, lastError: s.lastError ?? null };
  } catch {
    return { lastOkAt: null, failures: 0, lastError: null };
  }
}

function writeStatus(dataDir: string, status: StatusFile) {
  try {
    fs.writeFileSync(path.join(dataDir, STATUS_FILE), JSON.stringify(status), { mode: 0o600 });
  } catch {
    // the status file only feeds the Settings line; a backup outcome must not fail because of it
  }
}

export interface BackupStatus {
  /** Time of the newest copy on disk, ISO, or null when there is none. */
  lastBackupAt: string | null;
  /** Two failed runs in a row: Settings shows the red line. */
  failing: boolean;
}

export function backupStatus(dataDir: string): BackupStatus {
  const newest = listBackups(dataDir)[0];
  return { lastBackupAt: newest ? newest.at.toISOString() : null, failing: readStatus(dataDir).failures >= 2 };
}

/**
 * The launcher's timer: call tick() about once a minute. It notices commits by other connections (the web app) through
 * PRAGMA data_version, and saves a copy once the data has been quiet for 5 minutes, at most every 15 minutes.
 */
export function backupScheduler(db: Db, dataDir: string, log: (line: string) => void = console.log) {
  let version = db.pragma('data_version', { simple: true }) as number;
  let changedAt: number | null = null;
  let lastRunAt = Number.NEGATIVE_INFINITY;
  return {
    /** Changes made on this connection (the retention job) do not move data_version, so they are reported here. */
    markChanged(now = new Date()) {
      changedAt = now.getTime();
    },
    tick(now = new Date()) {
      const t = now.getTime();
      const v = db.pragma('data_version', { simple: true }) as number;
      if (v !== version) {
        version = v;
        changedAt = t;
      }
      if (changedAt === null || t - changedAt < BACKUP_QUIET_MS || t - lastRunAt < BACKUP_MIN_GAP_MS) return;
      lastRunAt = t;
      try {
        const r = saveBackup(db, dataDir, now);
        changedAt = null;
        log(r.saved ? `Backup saved: ${path.basename(r.path)}` : 'Backup skipped: no change since the last one');
      } catch (e) {
        log(`Backup failed: ${(e as Error).message}`);
      }
    },
  };
}
