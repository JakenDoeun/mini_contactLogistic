// The import check (docs/import-rules.md): read a courier "Today" export, keep only Shopee SHPE rows, group scan rows
// into parcels and find what staff must decide. Pure apart from parsing the file's bytes, so every rule is tested
// without a database; src/server/importer/store.ts saves the result and confirms it. Server only: the browser never
// decides which rows count.
import * as XLSX from 'xlsx';
import { normalizePhone } from '../../lib/parcel-logic.ts';
import { parseScanTime, trackingKey, trimSource } from '../db/values.ts';

export const RULES = [
  'send-outlet-shopee-shpe/v1',
  'tracking-code-key/v1',
  'scan-time-local/v1',
  'arrival-batch-date/v1',
  'scan-events-to-parcels/v1',
] as const;

/** Mapped columns; `Send Outlet` is fixed and not among them (rule send-outlet-shopee-shpe/v1). */
export type Field = 'tracking' | 'name' | 'phone' | 'scanTime' | 'scanType' | 'uploadTime' | 'scanSite';
export type Columns = Record<Field, string>;
export const DEFAULT_COLUMNS: Columns = {
  tracking: 'scan order number',
  name: 'consignee name',
  phone: 'consignee mobile',
  scanTime: 'scan time',
  scanType: 'scanTypeDesc',
  uploadTime: 'Upload Time',
  scanSite: 'scan site',
};
const REQUIRED: Field[] = ['tracking', 'name', 'phone', 'scanTime'];
const OUTLET_HEADER = 'Send Outlet';
const NO_OUTLET = 'This file has no Send Outlet column, so Shopee parcels cannot be identified. Nothing was imported.';

export type FileFormat = 'xlsx' | 'xls' | 'csv';
export type CheckErrorCode = 'unreadable' | 'empty' | 'no_send_outlet' | 'missing_column' | 'duplicate_column';

/** A file that cannot be imported at all; nothing is written for it but the failed check. */
export class ImportCheckError extends Error {
  readonly code: CheckErrorCode;
  constructor(code: CheckErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Format from the bytes, not the name: the company export is XLSX saved as `.xls`. */
export function detectFormat(bytes: Uint8Array): FileFormat {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'xlsx';
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'xls';
  return 'csv';
}

/** Every cell of the first sheet as text, header row first; blank rows dropped. */
export function readRows(bytes: Uint8Array): { format: FileFormat; rows: string[][] } {
  const format = detectFormat(bytes);
  let rows: string[][];
  try {
    const book =
      format === 'csv'
        ? // raw: true keeps CSV cells as written (no number or date guessing, so leading zeros stay).
          XLSX.read(new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, ''), { type: 'string', raw: true, dense: true })
        : XLSX.read(bytes, { type: 'array', dense: true });
    const sheet = book.Sheets[book.SheetNames[0]];
    rows = sheet ? XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false }) : [];
  } catch (e) {
    throw new ImportCheckError('unreadable', `This file could not be read as Excel or CSV (${(e as Error).message}). Nothing was imported.`);
  }
  if (rows.length < 1) throw new ImportCheckError('empty', 'This file is empty. Nothing was imported.');
  return { format, rows: rows.map((r) => r.map((c) => (c == null ? '' : String(c)))) };
}

/** Rule send-outlet-shopee-shpe/v1: exact `shopee shpe` after trimming (NBSP too) and lower-casing. */
export const isShopeeOutlet = (cell: string | undefined) => trimSource(cell ?? '').toLowerCase() === 'shopee shpe';

/** Names differing only in surrounding or repeated whitespace, or letter case, are the same name. */
export const sameNameKey = (name: string) => trimSource(name).replace(/\s+/g, ' ').toLowerCase();

const headerKey = (h: string) => trimSource(h).toLowerCase();

export type SourceRow = {
  /** Spreadsheet row number: the header is row 1. */
  sourceRow: number;
  code: string;
  name: string;
  phone: string;
  scanTypeRaw: string | null;
  scanTimeRaw: string | null;
  scanTimeUtc: string | null;
  scanDate: string | null;
  scanSiteRaw: string | null;
  uploadTimeRaw: string | null;
};

export type ParcelCandidate = {
  key: string;
  /** Distinct trimmed spellings of the code, in file order; more than one = blocked until staff pick. */
  spellings: string[];
  /** Distinct names after sameNameKey, first spelling of each kept; more than one = recipient conflict. */
  names: string[];
  /** Distinct phones after normalizePhone, first spelling of each kept; more than one = recipient conflict. */
  phones: string[];
  rows: SourceRow[];
  /** Earliest readable scan date of its rows; null when none can be read. */
  scanDate: string | null;
  /** Rows whose scan time cannot be read. */
  unparseableRows: number;
};

export type FileCheck = {
  /** The headers as found in the file for each field (null: optional and missing). */
  headersFound: Record<Field | 'outlet', string | null>;
  rowsTotal: number;
  rowsShopee: number;
  rowsExcluded: number;
  excludedCodes: number;
  parcels: ParcelCandidate[];
};

/** Headers, outlet filter and grouping for rows read from a file (header row first). */
export function checkRows(rows: string[][], columns: Columns = DEFAULT_COLUMNS): FileCheck {
  const header = rows[0] ?? [];
  const find = (name: string) => header.flatMap((h, i) => (headerKey(h) === headerKey(name) ? [i] : []));

  const outlet = find(OUTLET_HEADER);
  if (outlet.length !== 1) throw new ImportCheckError('no_send_outlet', NO_OUTLET);
  const col = {} as Record<Field, number | null>;
  for (const field of Object.keys(columns) as Field[]) {
    const at = find(columns[field]);
    if (at.length > 1) {
      throw new ImportCheckError('duplicate_column', `The column "${columns[field]}" appears more than once, so this file is ambiguous. Nothing was imported.`);
    }
    if (at.length === 0 && REQUIRED.includes(field)) {
      throw new ImportCheckError('missing_column', `This file has no "${columns[field]}" column. Nothing was imported.`);
    }
    col[field] = at[0] ?? null;
  }
  const headersFound = { outlet: header[outlet[0]] } as FileCheck['headersFound'];
  for (const field of Object.keys(col) as Field[]) headersFound[field] = col[field] === null ? null : header[col[field]!];

  const cell = (row: string[], field: Field) => (col[field] === null ? null : (row[col[field]!] ?? ''));
  const byKey = new Map<string, ParcelCandidate>();
  const excludedKeys = new Set<string>();
  let rowsShopee = 0;
  const data = rows.slice(1);
  data.forEach((row, i) => {
    const code = trimSource(cell(row, 'tracking') ?? '');
    // A Shopee row without a tracking code cannot become a parcel; it is counted with the excluded rows.
    if (!isShopeeOutlet(row[outlet[0]]) || !code) {
      if (code) excludedKeys.add(trackingKey(code));
      return;
    }
    rowsShopee++;
    const key = trackingKey(code);
    const scanTimeRaw = cell(row, 'scanTime');
    const parsed = parseScanTime(scanTimeRaw);
    const source: SourceRow = {
      sourceRow: i + 2,
      code,
      name: trimSource(cell(row, 'name') ?? ''),
      phone: trimSource(cell(row, 'phone') ?? ''),
      scanTypeRaw: cell(row, 'scanType'),
      scanTimeRaw,
      scanTimeUtc: parsed?.utc ?? null,
      scanDate: parsed?.date ?? null,
      scanSiteRaw: cell(row, 'scanSite'),
      uploadTimeRaw: cell(row, 'uploadTime'),
    };
    let p = byKey.get(key);
    if (!p) byKey.set(key, (p = { key, spellings: [], names: [], phones: [], rows: [], scanDate: null, unparseableRows: 0 }));
    p.rows.push(source);
    if (!p.spellings.includes(code)) p.spellings.push(code);
    if (!p.names.some((n) => sameNameKey(n) === sameNameKey(source.name))) p.names.push(source.name);
    if (!p.phones.some((n) => normalizePhone(n) === normalizePhone(source.phone))) p.phones.push(source.phone);
    if (!parsed) p.unparseableRows++;
    else if (!p.scanDate || parsed.date < p.scanDate) p.scanDate = parsed.date;
  });
  return {
    headersFound,
    rowsTotal: data.length,
    rowsShopee,
    rowsExcluded: data.length - rowsShopee,
    excludedCodes: excludedKeys.size,
    parcels: [...byKey.values()],
  };
}

export const checkFile = (bytes: Uint8Array, columns: Columns = DEFAULT_COLUMNS) => {
  const { format, rows } = readRows(bytes);
  return { format, ...checkRows(rows, columns) };
};

// ---- Classification: each unique parcel lands in exactly one of four states ---------------------------------------

export type ParcelState = 'db_duplicate' | 'left_out' | 'blocked' | 'ready';
/** A staff decision on a blocking finding: values picked from those shown, or the parcel left out of this import. */
export type StaffDecision = { resolution: 'chosen'; chosen: { name?: string; phone?: string; code?: string } } | { resolution: 'left_out' };
/** How the arrival date applies when the file's parcels were scanned on several dates (rule arrival-batch-date/v1). */
export type DateChoice = { kind: 'single_scan_date' } | { kind: 'all_on_batch_date' } | { kind: 'only_scan_date'; date: string };

export const needsConflictDecision = (p: ParcelCandidate) => p.names.length > 1 || p.phones.length > 1;
export const needsSpellingDecision = (p: ParcelCandidate) => p.spellings.length > 1;

/** The file's scan dates with parcels per date; parcels whose scan times cannot be read are under null. */
export function scanDates(parcels: ParcelCandidate[]) {
  const counts = new Map<string | null, number>();
  for (const p of parcels) counts.set(p.scanDate, (counts.get(p.scanDate) ?? 0) + 1);
  return [...counts].map(([date, parcels]) => ({ date, parcels })).sort((a, b) => (a.date ?? '9').localeCompare(b.date ?? '9'));
}

export type Classified = { key: string; state: ParcelState };

/**
 * Checked in this order: database duplicate, left out (by staff, or not on the chosen scan date), blocked (a recipient
 * conflict or code spelling without a decision), ready. A missing date choice is not a blocked parcel: it is reported as
 * dateChoiceNeeded, and Confirm refuses until it is made (docs/import-rules.md, Review).
 */
export function classify(
  parcels: ParcelCandidate[],
  existingKeys: Set<string>,
  decisions: { conflict: Map<string, StaffDecision>; spelling: Map<string, StaffDecision>; leftOut: Set<string> },
  choice: DateChoice | null,
): { parcels: Classified[]; counts: Record<ParcelState, number>; dateChoiceNeeded: boolean } {
  // Several scan dates, or unreadable scan times (their own group), need an explicit choice (arrival-batch-date/v1).
  const dates = scanDates(parcels);
  const dateChoiceNeeded = dates.length > 1 || dates.some((d) => d.date === null);
  const out = parcels.map((p): Classified => {
    const left =
      decisions.leftOut.has(p.key) ||
      decisions.conflict.get(p.key)?.resolution === 'left_out' ||
      decisions.spelling.get(p.key)?.resolution === 'left_out' ||
      (choice?.kind === 'only_scan_date' && p.scanDate !== choice.date);
    const blocked =
      (needsConflictDecision(p) && !decisions.conflict.has(p.key)) || (needsSpellingDecision(p) && !decisions.spelling.has(p.key));
    const state: ParcelState = existingKeys.has(p.key) ? 'db_duplicate' : left ? 'left_out' : blocked ? 'blocked' : 'ready';
    return { key: p.key, state };
  });
  const counts: Record<ParcelState, number> = { db_duplicate: 0, left_out: 0, blocked: 0, ready: 0 };
  for (const p of out) counts[p.state]++;
  return { parcels: out, counts, dateChoiceNeeded };
}
