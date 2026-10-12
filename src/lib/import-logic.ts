// Pure import rules shared by the mock services. No React, no I/O, so it runs under `node --test`.
// Checks are deliberately basic: the file must be readable and have the tracking-code column.
// Tracking codes already in the branch records are skipped, so existing phone numbers and
// notification history are never overwritten.

import type { Parcel } from './parcel-logic.ts';

export type ImportSource = 'manual' | 'folder';
export type ImportStatus = 'imported' | 'failed';

export interface ImportRecord {
  id: string;
  fileName: string;
  source: ImportSource;
  importedAt: string; // ISO timestamp
  /** Content fingerprint, so the same file is recognised again under any name. Null when unreadable. */
  fingerprint: string | null;
  totalRows: number;
  newRecords: number;
  duplicateCodes: string[];
  status: ImportStatus;
  failureReason?: string;
  newCodes: string[];
}

export interface ImportRow {
  tracking: string;
  recipient: string;
  phone: string;
}

export interface FileMeta {
  fileName: string;
  size: number;
  modifiedAt: string;
  source: ImportSource;
  fingerprint: string;
}

export interface PreviewRow {
  tracking: string;
  recipient: string;
  phone: string;
  /** Already in the branch records: skipped, and its phone and history stay as they are. */
  existing: boolean;
}

/** What staff confirm before anything is saved. */
export interface ImportPreview extends FileMeta {
  totalRows: number;
  newCodes: string[];
  duplicateCodes: string[];
  rows: PreviewRow[];
  /** Every new row in full, first occurrence of each code: what confirming adds to the parcel records. */
  newRows: ImportRow[];
  /** An earlier successful import of the same file content, if any. */
  duplicateOf: ImportRecord | null;
}

export const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];
export const MAX_BYTES = 10 * 1024 * 1024;
export const PREVIEW_ROWS = 8;

export function validateFile(file: { name: string; size: number }): string | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return `${file.name} is not an Excel or CSV export. Choose a .xlsx, .xls or .csv file.`;
  }
  if (file.size === 0) return `${file.name} is empty. Export the file again from the logistics system.`;
  if (file.size > MAX_BYTES) return `${file.name} is larger than 10 MB. Export a shorter date range.`;
  return null;
}

export const fileType = (name: string) => name.slice(name.lastIndexOf('.') + 1).toUpperCase();

function seededRandom(text: string) {
  let seed = 2166136261;
  for (const ch of text) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), seed | 1) + 0x6d2b79f5;
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Sokha', 'Dara', 'Srey Pich', 'Vanna', 'Bopha', 'Rithy', 'Chenda', 'Visal', 'Malis', 'Piseth', 'Sophea', 'Kosal'];
const LAST = ['Chan', 'Kim', 'Lim', 'Heng', 'Sok', 'Meas', 'Ouk', 'Phan', 'Ros', 'Touch'];

/** A stand-in fingerprint for sample files that have no real content. */
export const sampleFingerprint = (name: string) => `sample-${(seededRandom(name)() * 1e12).toFixed(0)}`;

const code = (rand: () => number) => `CB${Math.floor(rand() * 1e10).toString().padStart(10, '0')}`;
// Parcels that show up again in a later export, so ordinary files contain some duplicates too.
const CARRYOVER = Array.from({ length: 40 }, ((r) => () => code(r))(seededRandom('carryover')));

// Customers already in the sample parcel records, so imports show related parcels across files.
const RETURNING = ['012 345 678', '088 412 7730', '085 119 004'];

function mockPhone(rand: () => number) {
  const roll = rand();
  if (roll < 0.06) return ''; // the export left the phone blank
  if (roll < 0.12) return RETURNING[Math.floor(rand() * RETURNING.length)];
  return `0${[12, 15, 17, 77, 88, 96, 97][Math.floor(rand() * 7)]} ${String(Math.floor(rand() * 1e6)).padStart(6, '0').replace(/(\d{3})(\d{3})/, '$1 $2')}`;
}

// Same file name always yields the same rows, so re-importing a file produces real duplicates.
export function mockRows(fileName: string) {
  const rand = seededRandom(fileName);
  const count = 18 + Math.floor(rand() * 60);
  return Array.from({ length: count }, () => ({
    tracking: rand() < 0.15 ? CARRYOVER[Math.floor(rand() * CARRYOVER.length)] : code(rand),
    recipient: `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`,
    phone: mockPhone(rand),
  }));
}

/** `fileRows` are the parsed rows; the mock derives them from the file name. */
export function buildPreview(
  meta: FileMeta,
  knownCodes: ReadonlySet<string>,
  history: readonly ImportRecord[],
  fileRows: ImportRow[] = mockRows(meta.fileName),
): ImportPreview {
  const seen = new Set(knownCodes);
  const newCodes: string[] = [];
  const duplicateCodes: string[] = [];
  const newRows: ImportRow[] = [];
  const rows = fileRows.map((r) => {
    const existing = seen.has(r.tracking);
    if (existing) duplicateCodes.push(r.tracking);
    else {
      seen.add(r.tracking); // a code repeated inside the file is a duplicate too
      newCodes.push(r.tracking);
      newRows.push(r);
    }
    return { ...r, existing };
  });
  return {
    ...meta,
    totalRows: rows.length,
    newCodes,
    duplicateCodes,
    rows: rows.slice(0, PREVIEW_ROWS),
    newRows,
    duplicateOf: history.find((r) => r.status === 'imported' && r.fingerprint === meta.fingerprint) ?? null,
  };
}

export function recordFromPreview(p: ImportPreview, importedAt: string): ImportRecord {
  return {
    id: `${importedAt}-${p.fileName}`,
    fileName: p.fileName,
    source: p.source,
    importedAt,
    fingerprint: p.fingerprint,
    totalRows: p.totalRows,
    newRecords: p.newCodes.length,
    duplicateCodes: p.duplicateCodes,
    status: 'imported',
    newCodes: p.newCodes,
  };
}

/** The parcel records a confirmed import adds: only its new codes, first row of each. */
export const parcelsFromPreview = (p: ImportPreview, importedAt: string): Parcel[] =>
  p.newRows.map((r) => ({ code: r.tracking, recipient: r.recipient, phone: r.phone, importedAt, sourceFile: p.fileName }));

export function failedRecord(fileName: string, source: ImportSource, importedAt: string, reason: string): ImportRecord {
  return {
    id: `${importedAt}-${fileName}`,
    fileName,
    source,
    importedAt,
    fingerprint: null,
    totalRows: 0,
    newRecords: 0,
    duplicateCodes: [],
    status: 'failed',
    failureReason: reason,
    newCodes: [],
  };
}

export interface DaySummary {
  newRecords: number;
  duplicates: number;
  files: number;
}

export function summarizeDay(records: ImportRecord[], day: Date): DaySummary {
  const today = records.filter((r) => r.status === 'imported' && new Date(r.importedAt).toDateString() === day.toDateString());
  return {
    newRecords: today.reduce((n, r) => n + r.newRecords, 0),
    duplicates: today.reduce((n, r) => n + r.duplicateCodes.length, 0),
    files: today.length,
  };
}
