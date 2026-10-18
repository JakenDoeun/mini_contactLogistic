// Saving, reviewing and confirming imports (docs/import-rules.md; tables imports, import_review_items,
// parcel_scan_events in docs/phase1-schema.md). A check stores the original file once, by SHA-256, in the data
// folder; review and Confirm read it again, so the parsed rows never need a table of their own. Confirm is one
// BEGIN IMMEDIATE transaction that re-checks against the database as it is at that moment.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeAudit } from '../db/audit.ts';
import type { Db } from '../db/connection.ts';
import { insertNewParcels } from '../db/parcels.ts';
import { cambodiaDate, nowIso } from '../db/values.ts';
import {
  checkFile,
  classify,
  DEFAULT_COLUMNS,
  ImportCheckError,
  needsConflictDecision,
  needsSpellingDecision,
  RULES,
  scanDates,
  type Columns,
  type DateChoice,
  type FileCheck,
  type FileFormat,
  type ParcelCandidate,
  type StaffDecision,
} from './check.ts';

export const DUPLICATE_FILE_KEY = 'import.duplicate_file';
export const COLUMNS_KEY = 'import.columns';
export type DuplicateRule = 'warn' | 'block';

function setting<T>(db: Db, key: string, valid: (v: unknown) => v is T, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  const value = row ? (JSON.parse(row.value) as unknown) : fallback;
  return valid(value) ? value : fallback;
}
export const duplicateRule = (db: Db) => setting(db, DUPLICATE_FILE_KEY, (v): v is DuplicateRule => v === 'warn' || v === 'block', 'warn');
/** The mapped column headers: the documented defaults, each replaceable in Settings. */
export function importColumns(db: Db): Columns {
  const saved = setting(db, COLUMNS_KEY, (v): v is Partial<Columns> => typeof v === 'object' && v !== null && !Array.isArray(v), {});
  const out = { ...DEFAULT_COLUMNS };
  for (const field of Object.keys(out) as (keyof Columns)[]) {
    const name = saved[field];
    if (typeof name === 'string' && name.trim()) out[field] = name.trim();
  }
  return out;
}

// ---- The stored original ------------------------------------------------------------------------------------------

const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');

/** Saves the original once under imports/<sha256> (owner-only), and returns that path relative to the data folder. */
function storeOriginal(dataDir: string, hash: string, bytes: Uint8Array) {
  const dir = path.join(dataDir, 'imports');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(path.join(dir, hash), bytes, { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  return `imports/${hash}`;
}

function readOriginal(dataDir: string, storedPath: string, hash: string) {
  const bytes = fs.readFileSync(path.join(dataDir, storedPath));
  if (sha256(bytes) !== hash) throw new Error('the stored file no longer matches its SHA-256');
  return bytes;
}

// ---- Earlier imports of the same file -----------------------------------------------------------------------------

type Earlier = { id: number; date_choice: string; chosen_scan_date: string | null; confirmed_at: string; parcels_added: number };

/** Imported earlier from the same bytes: everything, or (re-review) only some scan dates. */
function earlierImports(db: Db, hash: string, exceptId = -1) {
  const rows = db
    .prepare(
      `SELECT id, date_choice, chosen_scan_date, confirmed_at, parcels_added FROM imports
       WHERE sha256 = ? AND status = 'imported' AND id <> ? ORDER BY id`,
    )
    .all(hash, exceptId) as Earlier[];
  const whole = rows.some((r) => r.date_choice !== 'only_scan_date');
  const datesDone = new Map(rows.filter((r) => r.date_choice === 'only_scan_date').map((r) => [r.chosen_scan_date!, r]));
  return { rows, whole, datesDone };
}

// ---- Check ---------------------------------------------------------------------------------------------------------

export type CheckInput = {
  bytes: Uint8Array;
  fileName: string;
  source: 'manual' | 'folder';
  detectedFileId?: number | null;
  userId: number | null;
  now?: Date;
};
export type CheckResult = { importId: number; status: 'checked' | 'no_eligible_rows' | 'failed'; errorCode?: string; message?: string };

const existingParcels = (db: Db, keys: string[]) =>
  new Map(
    (
      db
        .prepare('SELECT id, tracking_key, tracking_code, recipient_name, phone_raw FROM parcels WHERE tracking_key IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify(keys)) as { id: number; tracking_key: string; tracking_code: string; recipient_name: string; phone_raw: string | null }[]
    ).map((p) => [p.tracking_key, p]),
  );

/** Check a file and save the result for review. Nothing reaches the parcels table here. */
export function checkImport(db: Db, dataDir: string, input: CheckInput): CheckResult {
  const now = input.now ?? new Date();
  const at = now.toISOString();
  const hash = sha256(input.bytes);
  const storedPath = storeOriginal(dataDir, hash, input.bytes);
  // win32.basename splits on / and \ alike: some browsers send "C:\fakepath\name.xls" from any computer.
  const fileName = path.win32.basename(input.fileName).slice(0, 255) || 'file';
  const base = {
    source: input.source, detected: input.detectedFileId ?? null, fileName, storedPath, hash, size: input.bytes.length, at, userId: input.userId,
  };

  let check: (FileCheck & { format: FileFormat }) | null = null;
  let failure: { code: string; message: string } | null = null;
  const columns = importColumns(db);
  try {
    check = checkFile(input.bytes, columns);
  } catch (e) {
    if (!(e instanceof ImportCheckError)) throw e;
    failure = { code: e.code, message: e.message };
  }
  const earlier = earlierImports(db, hash);
  const fileDates = check ? scanDates(check.parcels).map((d) => d.date) : [];
  const remaining = fileDates.filter((d) => d !== null && !earlier.datesDone.has(d));
  const rerun = !earlier.whole && earlier.datesDone.size > 0 && remaining.length > 0;
  const duplicate = earlier.rows.length > 0 && !rerun;
  if (!failure && duplicate && duplicateRule(db) === 'block') {
    failure = { code: 'duplicate_file', message: `This file was already imported (${earlier.rows.at(-1)!.confirmed_at.slice(0, 10)}). Nothing was imported.` };
  }

  return db.transaction((): CheckResult => {
    if (failure || !check) {
      const id = insertImport(db, base, { status: 'failed', format: check?.format ?? null, error: failure!, columns });
      writeAudit(db, {
        action: 'import.checked', entity: 'import', entityIds: [id], outcome: 'failed', userId: input.userId, at,
        detail: { error_code: failure!.code, sha256: hash, source: input.source },
      });
      return { importId: id, status: 'failed', errorCode: failure!.code, message: failure!.message };
    }
    const existing = existingParcels(db, check.parcels.map((p) => p.key));
    const { counts } = classify(
      check.parcels, new Set(existing.keys()), { conflict: new Map(), spelling: new Map(), leftOut: new Set() },
      null,
    );
    const status = check.rowsShopee === 0 ? 'no_eligible_rows' : 'checked';
    const id = insertImport(db, base, {
      status, format: check.format, check, counts, columns, rerunOf: rerun ? earlier.rows.at(-1)!.id : null,
    });
    insertReviewItems(db, id, check.parcels, existing, at);
    writeAudit(db, {
      action: 'import.checked', entity: 'import', entityIds: [id], outcome: 'ok', userId: input.userId, at,
      detail: { counts: { ...counts, rows: check.rowsTotal, shopee_rows: check.rowsShopee }, rules: [...RULES], sha256: hash, source: input.source },
    });
    return { importId: id, status };
  })();
}

type Base = { source: string; detected: number | null; fileName: string; storedPath: string; hash: string; size: number; at: string; userId: number | null };

function insertImport(
  db: Db,
  b: Base,
  r: {
    status: string;
    format: FileFormat | null;
    columns: Columns;
    check?: FileCheck;
    counts?: Record<'db_duplicate' | 'left_out' | 'blocked' | 'ready', number>;
    error?: { code: string; message: string };
    rerunOf?: number | null;
  },
) {
  const c = r.check;
  const n = r.counts ?? { db_duplicate: 0, left_out: 0, blocked: 0, ready: 0 };
  const unique = c ? c.parcels.length : 0;
  const result = db
    .prepare(
      `INSERT INTO imports (source, detected_file_id, original_filename, stored_path, sha256, size_bytes, file_format, status,
         rerun_of_import_id, rules, headers_found, scan_dates, rows_total, rows_shopee, rows_excluded, excluded_codes,
         rows_collapsed, parcels_unique, db_duplicates, left_out, blocked, ready, error_code, error_detail, checked_at, checked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      b.source, b.detected, b.fileName, b.storedPath, b.hash, b.size, r.format, r.status,
      r.rerunOf ?? null, JSON.stringify(RULES), JSON.stringify({ columns: r.columns, found: c?.headersFound ?? null }),
      JSON.stringify(c ? scanDates(c.parcels) : []),
      c?.rowsTotal ?? 0, c?.rowsShopee ?? 0, c?.rowsExcluded ?? 0, c?.excludedCodes ?? 0, c ? c.rowsShopee - unique : 0, unique,
      n.db_duplicate, n.left_out, n.blocked, n.ready, r.error?.code ?? null, r.error?.message ?? null, b.at, b.userId,
    );
  return Number(result.lastInsertRowid);
}

function insertReviewItems(db: Db, importId: number, parcels: ParcelCandidate[], existing: ReturnType<typeof existingParcels>, at: string) {
  const insert = db.prepare(
    `INSERT INTO import_review_items (import_id, tracking_key, kind, blocking, detail, parcel_scan_date, existing_parcel_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const p of parcels) {
    const stored = existing.get(p.key);
    if (stored) {
      insert.run(
        importId, p.key, 'db_duplicate', 0,
        JSON.stringify({
          storedCode: stored.tracking_code,
          caseOnly: !p.spellings.includes(stored.tracking_code),
          fileNames: p.names, storedName: stored.recipient_name,
          filePhones: p.phones, storedPhone: stored.phone_raw,
        }),
        p.scanDate, stored.id, at,
      );
      continue;
    }
    if (needsConflictDecision(p)) {
      insert.run(importId, p.key, 'recipient_conflict', 1, JSON.stringify({ names: p.names, phones: p.phones }), p.scanDate, null, at);
    }
    if (needsSpellingDecision(p)) {
      insert.run(importId, p.key, 'code_spelling', 1, JSON.stringify({ spellings: p.spellings }), p.scanDate, null, at);
    }
    if (p.unparseableRows) {
      const rows = p.rows.filter((r) => !r.scanDate).map((r) => ({ row: r.sourceRow, text: r.scanTimeRaw }));
      insert.run(importId, p.key, 'unparseable_scan_time', 0, JSON.stringify({ rows }), null, null, at);
    }
  }
}

// ---- Review ---------------------------------------------------------------------------------------------------------

type ImportRow = {
  id: number; source: string; detected_file_id: number | null; original_filename: string; stored_path: string; sha256: string;
  size_bytes: number; file_format: FileFormat | null; status: string; rerun_of_import_id: number | null; headers_found: string;
  rows_total: number; rows_shopee: number; rows_excluded: number; excluded_codes: number; rows_collapsed: number;
  parcels_unique: number; db_duplicates: number; left_out: number; blocked: number; ready: number; parcels_added: number;
  error_code: string | null; error_detail: string | null; checked_at: string; confirmed_at: string | null;
  arrival_batch_date: string | null; date_choice: string | null; chosen_scan_date: string | null;
};
type ItemRow = {
  id: number; tracking_key: string; kind: string; blocking: number; detail: string; parcel_scan_date: string | null;
  resolution: 'chosen' | 'left_out' | null; chosen: string | null;
};

const importRow = (db: Db, id: number) => db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as ImportRow | undefined;
const itemsOf = (db: Db, id: number) =>
  db.prepare('SELECT id, tracking_key, kind, blocking, detail, parcel_scan_date, resolution, chosen FROM import_review_items WHERE import_id = ? ORDER BY id').all(id) as ItemRow[];

function decisionsOf(items: ItemRow[]) {
  const conflict = new Map<string, StaffDecision>();
  const spelling = new Map<string, StaffDecision>();
  for (const i of items) {
    if (!i.resolution) continue;
    const d: StaffDecision = i.resolution === 'left_out' ? { resolution: 'left_out' } : { resolution: 'chosen', chosen: JSON.parse(i.chosen!) };
    if (i.kind === 'recipient_conflict') conflict.set(i.tracking_key, d);
    if (i.kind === 'code_spelling') spelling.set(i.tracking_key, d);
  }
  return { conflict, spelling, leftOut: new Set<string>() };
}

/** Re-reads the stored file with the columns saved at check time. */
function recheck(dataDir: string, row: ImportRow) {
  const { columns } = JSON.parse(row.headers_found) as { columns: Columns };
  return checkFile(readOriginal(dataDir, row.stored_path, row.sha256), columns);
}

export type Review = ReturnType<typeof reviewImport>;

/** Everything the review screen shows, with the counts for `choice` (none yet: the counts as they stand). */
export function reviewImport(db: Db, dataDir: string, importId: number, choice: DateChoice | null = null, now = new Date()) {
  const row = importRow(db, importId);
  if (!row) return null;
  const items = itemsOf(db, importId).map((i) => ({
    id: i.id, key: i.tracking_key, kind: i.kind, blocking: i.blocking === 1, detail: JSON.parse(i.detail) as Record<string, unknown>,
    scanDate: i.parcel_scan_date, resolution: i.resolution, chosen: i.chosen ? (JSON.parse(i.chosen) as Record<string, string>) : null,
  }));
  const today = cambodiaDate(now);
  const base = {
    id: row.id, fileName: row.original_filename, source: row.source, status: row.status, format: row.file_format,
    sizeBytes: row.size_bytes, checkedAt: row.checked_at, confirmedAt: row.confirmed_at, arrivalBatchDate: row.arrival_batch_date,
    error: row.error_code ? { code: row.error_code, message: row.error_detail } : null,
    rows: { total: row.rows_total, shopee: row.rows_shopee, excluded: row.rows_excluded, excludedCodes: row.excluded_codes, collapsed: row.rows_collapsed },
    rules: [...RULES], today, items,
  };
  if (row.status !== 'checked') {
    return {
      ...base, live: false,
      counts: { unique: row.parcels_unique, db_duplicate: row.db_duplicates, left_out: row.left_out, blocked: row.blocked, ready: row.ready },
      scanDates: [] as { date: string | null; parcels: number; importedBefore: boolean }[], dateChoiceNeeded: false, scanDateDiffers: false,
      earlier: [] as { id: number; confirmedAt: string; scanDate: string | null; parcels: number }[], rerunOf: row.rerun_of_import_id,
      canConfirm: false, refusals: [`This import is ${row.status.replace(/_/g, ' ')}.`],
    };
  }
  const check = recheck(dataDir, row);
  const existing = existingParcels(db, check.parcels.map((p) => p.key));
  const earlier = earlierImports(db, row.sha256, row.id);
  const result = classify(check.parcels, new Set(existing.keys()), decisionsOf(itemsOf(db, importId)), choice);
  const dates = scanDates(check.parcels).map((d) => ({ ...d, importedBefore: d.date !== null && earlier.datesDone.has(d.date) }));
  const scanDateDiffers = dates.some((d) => d.date !== null && d.date !== today);
  const refusals = confirmRefusals(row, check, result, choice, earlier, { batchDateChosen: false, needsBatchDate: false });
  return {
    ...base, live: true,
    counts: { unique: check.parcels.length, ...result.counts },
    scanDates: dates, dateChoiceNeeded: result.dateChoiceNeeded, scanDateDiffers,
    earlier: earlier.rows.map((r) => ({ id: r.id, confirmedAt: r.confirmed_at, scanDate: r.chosen_scan_date, parcels: r.parcels_added })),
    rerunOf: row.rerun_of_import_id, canConfirm: refusals.length === 0, refusals,
  };
}

function confirmRefusals(
  row: ImportRow,
  check: FileCheck,
  result: ReturnType<typeof classify>,
  choice: DateChoice | null,
  earlier: ReturnType<typeof earlierImports>,
  batch: { batchDateChosen: boolean; needsBatchDate: boolean },
): string[] {
  const out: string[] = [];
  if (row.status !== 'checked') return [`This import is ${row.status.replace(/_/g, ' ')}.`];
  if (check.rowsShopee === 0) out.push('No Shopee SHPE parcels in this file.');
  const fileDates = scanDates(check.parcels).map((d) => d.date);
  if (result.dateChoiceNeeded && !(choice?.kind === 'all_on_batch_date' || choice?.kind === 'only_scan_date')) {
    out.push('Choose how the scan dates apply: all on the Arrival Batch Date, or only one scan date.');
  }
  if (choice?.kind === 'only_scan_date' && !fileDates.includes(choice.date)) out.push(`No parcels were scanned on ${choice.date}.`);
  if (row.rerun_of_import_id !== null) {
    if (choice?.kind !== 'only_scan_date') out.push('This file was partly imported before: choose one of its remaining scan dates.');
    else if (earlier.datesDone.has(choice.date)) out.push(`Parcels scanned on ${choice.date} were already imported from this file.`);
  }
  if (result.counts.blocked > 0) out.push(`${result.counts.blocked} parcel(s) need a decision first.`);
  if (batch.needsBatchDate && !batch.batchDateChosen) out.push('The scan date is not today: confirm the Arrival Batch Date first.');
  return out;
}

// ---- Decisions, cancel, history ---------------------------------------------------------------------------------------

/** A decision must pick values the file actually offers for that parcel. */
export function validDecision(db: Db, dataDir: string, itemId: number, decision: StaffDecision): string | null {
  const item = db.prepare('SELECT import_id, tracking_key, kind FROM import_review_items WHERE id = ?').get(itemId) as
    | { import_id: number; tracking_key: string; kind: string }
    | undefined;
  if (!item) return 'No such review item.';
  if (item.kind !== 'recipient_conflict' && item.kind !== 'code_spelling') return 'Only conflicts and spellings take a decision.';
  if (decision.resolution === 'left_out') return null;
  const row = importRow(db, item.import_id)!;
  const p = recheck(dataDir, row).parcels.find((x) => x.key === item.tracking_key);
  if (!p) return 'The parcel is not in the file.';
  const c = decision.chosen;
  if (item.kind === 'recipient_conflict' && !(c.name !== undefined && p.names.includes(c.name) && c.phone !== undefined && p.phones.includes(c.phone))) {
    return 'Choose a name and a phone from those in the file.';
  }
  if (item.kind === 'code_spelling' && !(c.code !== undefined && p.spellings.includes(c.code))) return 'Choose one of the spellings in the file.';
  return null;
}

export function cancelImport(db: Db, importId: number, userId: number | null, at = nowIso()) {
  return db.transaction(() => {
    const changed = db.prepare("UPDATE imports SET status = 'cancelled' WHERE id = ? AND status = 'checked'").run(importId).changes;
    if (changed) {
      writeAudit(db, { action: 'import.cancelled', entity: 'import', entityIds: [importId], outcome: 'ok', userId, at, detail: { status_from: 'checked', status_to: 'cancelled' } });
    }
    return changed === 1;
  })();
}

export function listImports(db: Db, limit = 100) {
  return db
    .prepare(
      `SELECT id, source, original_filename AS fileName, status, file_format AS format, rows_total AS rowsTotal, rows_shopee AS rowsShopee,
         parcels_unique AS parcels, db_duplicates AS duplicates, parcels_added AS added, arrival_batch_date AS arrivalBatchDate,
         error_code AS errorCode, error_detail AS errorDetail, checked_at AS checkedAt, confirmed_at AS confirmedAt
       FROM imports WHERE source <> 'seed' ORDER BY id DESC LIMIT ?`,
    )
    .all(limit);
}

// ---- Confirm ------------------------------------------------------------------------------------------------------

export type ConfirmInput = {
  arrivalBatchDate: string;
  dateChoice: DateChoice;
  /** The operator chose the Arrival Batch Date explicitly (required when a scan date is not today). */
  batchDateChosen: boolean;
  userId: number | null;
  now?: Date;
};
export type ConfirmResult = { ok: true; added: number } | { ok: false; reason: 'not_found' | 'refused' | 'failed'; messages: string[] };

const realDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/**
 * One BEGIN IMMEDIATE transaction: re-check the file against the database as it is now, insert only new parcels and
 * their scan events, record the date choice and counts, and audit. A refusal changes nothing; an unexpected error rolls
 * everything back and marks the import failed with its reason.
 */
export function confirmImport(db: Db, dataDir: string, importId: number, input: ConfirmInput): ConfirmResult {
  const now = input.now ?? new Date();
  const at = now.toISOString();
  const today = cambodiaDate(now);
  const run = db.transaction((): ConfirmResult => {
    const row = importRow(db, importId);
    if (!row) return { ok: false, reason: 'not_found', messages: ['No such import.'] };
    if (row.status !== 'checked') return { ok: false, reason: 'refused', messages: [`This import is ${row.status.replace(/_/g, ' ')}.`] };
    if (!realDate(input.arrivalBatchDate)) return { ok: false, reason: 'refused', messages: ['The Arrival Batch Date is not a real date.'] };
    const check = recheck(dataDir, row);
    const existing = existingParcels(db, check.parcels.map((p) => p.key));
    const items = itemsOf(db, importId);
    const decisions = decisionsOf(items);
    const result = classify(check.parcels, new Set(existing.keys()), decisions, input.dateChoice);
    const earlier = earlierImports(db, row.sha256, row.id);
    const needsBatchDate = scanDates(check.parcels).some((d) => d.date !== null && d.date !== today);
    const refusals = confirmRefusals(row, check, result, input.dateChoice, earlier, { batchDateChosen: input.batchDateChosen, needsBatchDate });
    if (refusals.length) return { ok: false, reason: 'refused', messages: refusals };

    const byKey = new Map(check.parcels.map((p) => [p.key, p]));
    const ready = result.parcels.filter((p) => p.state === 'ready').map((p) => byKey.get(p.key)!);
    const pick = (p: ParcelCandidate) => {
      const c = decisions.conflict.get(p.key);
      const s = decisions.spelling.get(p.key);
      const chosen = (d: StaffDecision | undefined) => (d?.resolution === 'chosen' ? d.chosen : {});
      return {
        trackingCode: chosen(s).code ?? p.spellings[0],
        recipientName: chosen(c).name ?? p.names[0],
        phoneRaw: chosen(c).phone ?? p.phones[0],
        arrivalDate: input.arrivalBatchDate,
      };
    };
    const { inserted } = insertNewParcels(db, importId, ready.map(pick), at);
    if (inserted.length !== ready.length) throw new Error(`expected ${ready.length} new parcels, inserted ${inserted.length}`);

    const ids = new Map(
      (db.prepare('SELECT id, tracking_key FROM parcels WHERE first_import_id = ?').all(importId) as { id: number; tracking_key: string }[]).map((p) => [
        p.tracking_key, p.id,
      ]),
    );
    const event = db.prepare(
      `INSERT INTO parcel_scan_events (parcel_id, import_id, source_row, tracking_code_raw, scan_type_raw, scan_time_raw, scan_time_utc,
         scan_date, scan_site_raw, upload_time_raw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of ready) {
      for (const r of p.rows) {
        event.run(ids.get(p.key), importId, r.sourceRow, r.code, r.scanTypeRaw, r.scanTimeRaw, r.scanTimeUtc, r.scanDate, r.scanSiteRaw, r.uploadTimeRaw, at);
      }
    }
    if (input.dateChoice.kind === 'only_scan_date') {
      const left = db.prepare(
        `INSERT INTO import_review_items (import_id, tracking_key, kind, blocking, detail, parcel_scan_date, created_at)
         VALUES (?, ?, 'not_chosen_scan_date', 0, ?, ?, ?)`,
      );
      for (const p of check.parcels) {
        if (!existing.has(p.key) && p.scanDate !== input.dateChoice.date) left.run(importId, p.key, JSON.stringify({ chosen: input.dateChoice.date }), p.scanDate, at);
      }
    }
    const c = result.counts;
    db.prepare(
      `UPDATE imports SET status = 'imported', confirmed_at = ?, confirmed_by = ?, arrival_batch_date = ?, arrival_date_changed = ?,
         date_choice = ?, chosen_scan_date = ?, db_duplicates = ?, left_out = ?, blocked = 0, ready = ?, parcels_added = ?
       WHERE id = ?`,
    ).run(
      at, input.userId, input.arrivalBatchDate, input.arrivalBatchDate === today ? 0 : 1, input.dateChoice.kind,
      input.dateChoice.kind === 'only_scan_date' ? input.dateChoice.date : null, c.db_duplicate, c.left_out, c.ready, inserted.length, importId,
    );
    if (row.detected_file_id !== null) db.prepare("UPDATE detected_files SET state = 'imported', import_id = ? WHERE id = ?").run(importId, row.detected_file_id);
    writeAudit(db, {
      action: 'import.confirmed', entity: 'import', entityIds: { import: [importId], parcel: inserted }, outcome: 'ok', userId: input.userId, at,
      detail: { counts: { ...c, added: inserted.length }, arrival_dates: [input.arrivalBatchDate], sha256: row.sha256, source: row.source },
    });
    return { ok: true, added: inserted.length };
  });
  try {
    return run.immediate();
  } catch (e) {
    const message = (e as Error).message.slice(0, 300);
    db.transaction(() => {
      if (db.prepare("UPDATE imports SET status = 'failed', error_code = 'confirm_failed', error_detail = ? WHERE id = ? AND status = 'checked'").run(message, importId).changes) {
        writeAudit(db, { action: 'import.failed', entity: 'import', entityIds: [importId], outcome: 'failed', userId: input.userId, at, detail: { error_code: 'confirm_failed' } });
      }
    })();
    return { ok: false, reason: 'failed', messages: [`The import failed and nothing was saved: ${message}`] };
  }
}
