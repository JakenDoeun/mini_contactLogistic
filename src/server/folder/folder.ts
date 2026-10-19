// The watched folder (plan: Imports, Folder watcher; Phase 5). One scan routine serves Scan Folder Now (web app) and the
// automatic check (scripts/serve.ts, off by default, owner 2026-10-19). A scan only records finished export files in
// detected_files; nothing is parsed or imported until a staff member opens a file's review and confirms it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeAudit } from '../db/audit.ts';
import type { Db } from '../db/connection.ts';
import { checkImport } from '../importer/store.ts';

export const FOLDER_KEY = 'folder.settings';
const LAST_SCAN_KEY = 'folder.last_scan';
export const CHECK_INTERVALS = [30, 60, 120, 300];
const MAX_BYTES = 10 * 1024 * 1024;
const EXPORT_FILE = /\.(xlsx|xls|csv)$/i;

export type FolderSettings = { path: string | null; auto: boolean; intervalSeconds: number };
export type LastScan = { at: string; by: 'auto' | 'manual'; ok: boolean; message: string | null; added: number };

/** Windows: a folder every account on the computer can use, which the installer creates. Elsewhere: none until chosen. */
export const defaultFolder = () =>
  process.platform === 'win32' ? path.win32.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Documents', 'Campus Branch Imports') : null;

function readSetting(db: Db, key: string): unknown {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : undefined;
}
const writeSetting = (db: Db, key: string, value: unknown, userId: number | null, at: string) =>
  db
    .prepare(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), userId, at);

export function folderSettings(db: Db): FolderSettings {
  const s = (readSetting(db, FOLDER_KEY) ?? {}) as Partial<FolderSettings>;
  return {
    path: typeof s.path === 'string' && s.path ? s.path : defaultFolder(),
    auto: s.auto === true,
    intervalSeconds: CHECK_INTERVALS.includes(s.intervalSeconds as number) ? (s.intervalSeconds as number) : 60,
  };
}

/** Why a folder cannot be used, in words staff can act on; null when it can be listed. */
export function folderProblem(folder: string): string | null {
  if (!path.isAbsolute(folder)) return 'Use the full path, for example C:\\Users\\Public\\Documents\\Campus Branch Imports.';
  try {
    if (!fs.statSync(folder).isDirectory()) return `${folder} is a file, not a folder.`;
    fs.readdirSync(folder);
    return null;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return `${folder} does not exist, or its drive is not connected.`;
    if (code === 'EACCES' || code === 'EPERM') return `The app is not allowed to open ${folder}. Use the shared Campus Branch Imports folder, or give the app's account read access.`;
    return `${folder} cannot be opened right now (${code ?? 'unknown error'}).`;
  }
}

export type SaveFolderResult = { ok: true } | { ok: false; reason: 'not_admin' | 'invalid'; message: string };

/** Admin only, like the other branch-wide settings; audited without the path. */
export function setFolderSettings(db: Db, userId: number, input: Record<string, unknown>, now = new Date()): SaveFolderResult {
  const at = now.toISOString();
  const admin = (db.prepare('SELECT is_admin FROM users WHERE id = ? AND disabled = 0').get(userId) as { is_admin: number } | undefined)?.is_admin;
  if (!admin) {
    writeAudit(db, { action: 'settings.refused', entity: 'settings', entityIds: [], outcome: 'refused', userId, at, detail: { error_code: 'not_admin', settings_keys: [FOLDER_KEY] } });
    return { ok: false, reason: 'not_admin', message: 'Only the admin account can change the watched folder.' };
  }
  const folder = typeof input.path === 'string' ? input.path.trim() : '';
  if (typeof input.auto !== 'boolean' || !CHECK_INTERVALS.includes(input.intervalSeconds as number)) {
    return { ok: false, reason: 'invalid', message: 'The settings could not be read. Reload the page and try again.' };
  }
  if (!folder) return { ok: false, reason: 'invalid', message: 'Enter the folder the courier export is saved to.' };
  const problem = folderProblem(folder);
  if (problem) return { ok: false, reason: 'invalid', message: problem };
  db.transaction(() => {
    writeSetting(db, FOLDER_KEY, { path: folder, auto: input.auto, intervalSeconds: input.intervalSeconds }, userId, at);
    writeAudit(db, { action: 'settings.changed', entity: 'settings', entityIds: [], outcome: 'ok', userId, at, detail: { settings_keys: [FOLDER_KEY] } });
  })();
  return { ok: true };
}

// ---- Scan ----------------------------------------------------------------------------------------------------------

type Seen = { name: string; full: string; size: number; modifiedAt: string };

function listExports(folder: string): Seen[] {
  return fs
    .readdirSync(folder, { withFileTypes: true })
    // ~$name is Excel's lock file beside an open workbook.
    .filter((e) => e.isFile() && EXPORT_FILE.test(e.name) && !e.name.startsWith('~$') && !e.name.startsWith('.'))
    .flatMap((e) => {
      const full = path.join(folder, e.name);
      try {
        const s = fs.statSync(full);
        return [{ name: e.name, full, size: s.size, modifiedAt: s.mtime.toISOString() }];
      } catch {
        return []; // removed between listing and stat
      }
    });
}

export type ScanResult = { ok: boolean; message: string | null; found: number; added: number; writing: string[]; unreadable: string[]; tooLarge: string[] };

/**
 * A file counts once its size and modified time stay the same across `settleMs` and it can be read whole (plan: "still
 * being written" until then). Each finished file is one detected_files row (unique on path, size, modified time); a copy
 * whose SHA-256 was already imported is recorded as imported. Rows for files no longer in the folder are set aside.
 */
export async function scanFolder(db: Db, by: 'auto' | 'manual', settleMs = 2000, userId: number | null = null): Promise<ScanResult> {
  const at = new Date().toISOString();
  const result: ScanResult = { ok: true, message: null, found: 0, added: 0, writing: [], unreadable: [], tooLarge: [] };
  const finish = (r: ScanResult) => {
    writeSetting(db, LAST_SCAN_KEY, { at, by, ok: r.ok, message: r.message, added: r.added } satisfies LastScan, null, at);
    return r;
  };
  const folder = folderSettings(db).path;
  const problem = folder ? folderProblem(folder) : 'No folder is chosen yet. Choose one in Settings.';
  if (problem) return finish({ ...result, ok: false, message: problem });

  const first = listExports(folder!);
  if (settleMs && first.length) await new Promise((r) => setTimeout(r, settleMs));
  const now = new Map(listExports(folder!).map((f) => [f.full, f]));

  const findRow = db.prepare('SELECT id, state FROM detected_files WHERE path = ? AND size_bytes = ? AND modified_at = ?');
  const importedAs = db.prepare("SELECT id FROM imports WHERE sha256 = ? AND status = 'imported' ORDER BY id DESC LIMIT 1");
  const keep: number[] = [];
  const writes: (() => void)[] = [];
  const added: number[] = [];

  for (const f of first) {
    const again = now.get(f.full);
    if (!again || again.size !== f.size || again.modifiedAt !== f.modifiedAt || f.size === 0) {
      result.writing.push(f.name);
      continue;
    }
    if (f.size > MAX_BYTES) {
      result.tooLarge.push(f.name);
      continue;
    }
    result.found++;
    const row = findRow.get(f.full, f.size, f.modifiedAt) as { id: number; state: string } | undefined;
    if (row && row.state !== 'unreadable') {
      keep.push(row.id);
      continue;
    }
    let hash: string | null = null;
    try {
      const bytes = fs.readFileSync(f.full);
      if (bytes.length === f.size) hash = crypto.createHash('sha256').update(bytes).digest('hex');
    } catch {
      // Open in Excel with a write lock, or the export still holds it: try again on the next scan.
    }
    if (!hash) result.unreadable.push(f.name);
    const done = hash ? (importedAs.get(hash) as { id: number } | undefined) : undefined;
    const state = !hash ? 'unreadable' : done ? 'imported' : 'waiting';
    writes.push(() => {
      if (row) {
        db.prepare('UPDATE detected_files SET sha256 = ?, state = ?, import_id = ? WHERE id = ?').run(hash, state, done?.id ?? null, row.id);
        keep.push(row.id);
        if (state === 'waiting') added.push(row.id);
      } else {
        const id = Number(
          db
            .prepare('INSERT INTO detected_files (path, size_bytes, modified_at, sha256, state, first_seen_at, import_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(f.full, f.size, f.modifiedAt, hash, state, at, done?.id ?? null).lastInsertRowid,
        );
        keep.push(id);
        if (state === 'waiting') added.push(id);
      }
    });
  }

  db.transaction(() => {
    for (const w of writes) w();
    // Removed or changed since it was found: that version can no longer be reviewed.
    db.prepare("UPDATE detected_files SET state = 'dismissed' WHERE state IN ('waiting', 'unreadable') AND id NOT IN (SELECT value FROM json_each(?))").run(
      JSON.stringify(keep),
    );
    result.added = added.length;
    if (added.length) {
      writeAudit(db, { action: 'folder.detected', entity: 'detected_file', entityIds: added, outcome: 'ok', userId, at, detail: { counts: { added: added.length }, source: by } });
    }
    finish(result);
  })();
  return result;
}

// ---- What the screens show ------------------------------------------------------------------------------------------

export type DetectedFile = {
  id: number; fileName: string; sizeBytes: number; modifiedAt: string; state: 'waiting' | 'unreadable' | 'imported';
  firstSeenAt: string; importId: number | null; importStatus: string | null;
};

export function folderState(db: Db) {
  const files = (
    db
      .prepare(
        `SELECT d.id, d.path, d.size_bytes AS sizeBytes, d.modified_at AS modifiedAt, d.state, d.first_seen_at AS firstSeenAt,
           coalesce(i.id, d.import_id) AS importId, i.status AS importStatus
         FROM detected_files d
         LEFT JOIN imports i ON i.id = (SELECT max(id) FROM imports WHERE detected_file_id = d.id)
         WHERE d.state IN ('waiting', 'unreadable') OR (d.state = 'imported' AND d.first_seen_at >= ?)
         ORDER BY d.first_seen_at DESC, d.id DESC LIMIT 20`,
      )
      .all(new Date(Date.now() - 24 * 3600_000).toISOString()) as (Omit<DetectedFile, 'fileName'> & { path: string })[]
  ).map(({ path: p, ...f }) => ({ ...f, fileName: path.win32.basename(p) }));
  return { ...folderSettings(db), lastScan: (readSetting(db, LAST_SCAN_KEY) as LastScan | undefined) ?? null, files };
}

// ---- Review and dismiss ------------------------------------------------------------------------------------------

export type CheckDetectedResult = { ok: true; importId: number } | { ok: false; reason: 'not_found' | 'changed' | 'unreadable'; message: string };

/** Open a found file's review: the file as it is now must still be the version that was found. */
export function checkDetectedFile(db: Db, dataDir: string, id: number, userId: number): CheckDetectedResult {
  const row = db.prepare('SELECT path, size_bytes, modified_at, sha256, state FROM detected_files WHERE id = ?').get(id) as
    | { path: string; size_bytes: number; modified_at: string; sha256: string | null; state: string }
    | undefined;
  if (!row || row.state === 'dismissed') return { ok: false, reason: 'not_found', message: 'This file is no longer in the list. Scan the folder again.' };
  const open = db.prepare("SELECT id FROM imports WHERE detected_file_id = ? AND status = 'checked' ORDER BY id DESC LIMIT 1").get(id) as { id: number } | undefined;
  if (open) return { ok: true, importId: open.id };

  const changed = (): CheckDetectedResult => {
    db.prepare("UPDATE detected_files SET state = 'dismissed' WHERE id = ? AND state IN ('waiting', 'unreadable')").run(id);
    return { ok: false, reason: 'changed', message: 'This file was changed or removed after it was found. Scan the folder again.' };
  };
  let bytes: Buffer;
  try {
    const s = fs.statSync(row.path);
    if (s.size !== row.size_bytes || s.mtime.toISOString() !== row.modified_at) return changed();
    bytes = fs.readFileSync(row.path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return changed();
    return { ok: false, reason: 'unreadable', message: 'The file cannot be read right now. Close it in Excel, wait a moment, then try again.' };
  }
  if (row.sha256 && crypto.createHash('sha256').update(bytes).digest('hex') !== row.sha256) return changed();
  const r = checkImport(db, dataDir, { bytes, fileName: row.path, source: 'folder', detectedFileId: id, userId });
  return { ok: true, importId: r.importId };
}

export function dismissDetectedFile(db: Db, id: number, userId: number) {
  return db.transaction(() => {
    const changed = db.prepare("UPDATE detected_files SET state = 'dismissed' WHERE id = ? AND state IN ('waiting', 'unreadable')").run(id).changes;
    if (changed) writeAudit(db, { action: 'folder.dismissed', entity: 'detected_file', entityIds: [id], outcome: 'ok', userId, detail: { status_from: 'waiting', status_to: 'dismissed' } });
    return changed === 1;
  })();
}
