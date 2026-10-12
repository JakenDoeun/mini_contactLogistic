// Mock backend. Each export matches the shape a real API call should return, so swapping
// these bodies for fetch() calls leaves the components untouched.
import {
  buildPreview,
  failedRecord,
  mockRows,
  parcelsFromPreview,
  recordFromPreview,
  sampleFingerprint,
  type FileMeta,
  type ImportPreview,
  type ImportRecord,
  type ImportSource,
} from '@/lib/import-logic';
import { addParcels, currentParcels, seedData } from './parcel-service';
import { getSettings } from './settings-service';

// Kept in their own file so the server-rendered Import Arrivals page can read them without the client stores.
export { PREVIEW_MODES, type PreviewMode } from './preview-modes';
import type { PreviewMode } from './preview-modes';

export interface MonitorActivity {
  at: string;
  fileName: string;
  outcome: 'waiting' | 'imported' | 'failed';
  note: string;
}

// 'preview' means no watcher service is connected, so nothing is being watched. The real API never returns it.
export type MonitorStatus = 'active' | 'inactive' | 'error' | 'preview';

export interface MonitorState {
  folderPath: string;
  checkIntervalSeconds: number;
  status: MonitorStatus;
  /** True while the state comes from this mock rather than a running watcher. */
  simulated: boolean;
  statusDetail?: string;
  lastDetectedFile: string | null;
  /** Detected files nobody has reviewed yet. They are never imported without staff confirming. */
  waiting: number;
  activity: MonitorActivity[];
}

/** A file found in the watched folder. Found is not imported: staff review and confirm it first. */
export interface DetectedFile extends FileMeta {
  status: 'new' | 'imported' | 'unreadable';
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

// Tracking codes come from the shared parcel records, so Parcels, Scan and Dashboard see what was imported.
const knownCodes = () => new Set(currentParcels().map((p) => p.code));
let history: ImportRecord[] | null = null;

const sample = (fileName: string, source: ImportSource, mins: number, size: number): FileMeta => ({
  fileName,
  source,
  modifiedAt: minutesAgo(mins),
  size,
  fingerprint: sampleFingerprint(fileName),
});

// A sample file's rows are its sample parcels; any other file gets generated rows.
function rowsOf(meta: FileMeta) {
  const seeded = seedData().parcels.filter((p) => sampleFingerprint(p.sourceFile) === meta.fingerprint);
  return seeded.length ? seeded.map((p) => ({ tracking: p.code, recipient: p.recipient, phone: p.phone })) : mockRows(meta.fileName);
}

const sourceOf = (fileName: string): ImportSource => (fileName.endsWith('.csv') ? 'manual' : 'folder');

// The sample history is the sample parcels' own import batches, so the two always agree.
function seedHistory(): ImportRecord[] {
  const batches = new Map<string, { at: string; codes: string[] }>();
  for (const p of seedData().parcels) {
    const b = batches.get(p.sourceFile) ?? { at: p.importedAt, codes: [] };
    b.codes.push(p.code);
    batches.set(p.sourceFile, b);
  }
  const records: ImportRecord[] = [...batches].map(([fileName, b]) => ({
    id: `${b.at}-${fileName}`,
    fileName,
    source: sourceOf(fileName),
    importedAt: b.at,
    fingerprint: sampleFingerprint(fileName),
    totalRows: b.codes.length,
    newRecords: b.codes.length,
    duplicateCodes: [],
    status: 'imported',
    newCodes: b.codes,
  }));
  const oldest = records.reduce((a, b) => (a.importedAt < b.importedAt ? a : b));
  records.push(
    failedRecord(`${oldest.fileName.replace(/\.\w+$/, '')} (1).xlsx`, 'manual', oldest.importedAt, 'The file could not be read. It was probably still open in Excel.'),
  );
  return records.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

const getHistory = () => (history ??= seedHistory());

// What the folder holds right now: a new export, one still being written, and the latest one already imported.
// Imported is worked out from fingerprints, not names.
let folder: (FileMeta & { unreadable?: boolean })[] | null = null;
function folderContents() {
  if (folder) return folder;
  const latest = getHistory().find((r) => r.source === 'folder' && r.status === 'imported')!;
  const day = latest.fileName.match(/_(\d{4})_/)?.[1] ?? 'today';
  folder = [
    sample(`arrivals_export_${day}_new.xlsx`, 'folder', 18, 58_200),
    { ...sample(`arrivals_export_${day}_partial.xlsx`, 'folder', 4, 12_000), unreadable: true },
    { ...sample(latest.fileName, 'folder', 0, 47_100), modifiedAt: latest.importedAt },
  ];
  return folder;
}

function folderFiles(): DetectedFile[] {
  const done = new Set(getHistory().flatMap((r) => (r.status === 'imported' ? [r.fingerprint] : [])));
  return folderContents().map(({ unreadable, ...f }) => ({ ...f, status: unreadable ? 'unreadable' : done.has(f.fingerprint) ? 'imported' : 'new' }));
}

export async function getImportHistory(mode: PreviewMode): Promise<ImportRecord[]> {
  await wait(700);
  if (mode === 'history-error') throw new Error('The import history service did not respond.');
  if (mode === 'empty') return [];
  return [...getHistory()];
}

/** Scan Folder Now: list what is in the watched folder. Nothing is imported here. */
export async function scanFolder(mode: PreviewMode): Promise<DetectedFile[]> {
  await wait(900);
  if (mode === 'monitor-error') throw new Error(`${getSettings().watchedFolder} cannot be reached. Check that the drive is connected.`);
  if (mode === 'empty') return [];
  return folderFiles().sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export type CheckStage = 'Reading file' | 'Looking for the tracking-code column' | 'Matching tracking codes';
export const CHECK_STAGES: CheckStage[] = ['Reading file', 'Looking for the tracking-code column', 'Matching tracking codes'];

export type CheckResult = { ok: true; preview: ImportPreview } | { ok: false; record: ImportRecord };

/** The basic checks, then a preview for staff to confirm. A failed check is logged in the history. */
export async function checkFile(
  meta: FileMeta & { unreadable?: boolean },
  mode: PreviewMode,
  onStage: (stage: CheckStage, index: number) => void,
): Promise<CheckResult> {
  const fail = (reason: string): CheckResult => {
    const record = failedRecord(meta.fileName, meta.source, new Date().toISOString(), reason);
    history = [record, ...getHistory()];
    return { ok: false, record };
  };
  for (const [i, stage] of CHECK_STAGES.entries()) {
    onStage(stage, i);
    await wait(500);
    if (stage === 'Reading file' && (mode === 'unreadable' || meta.unreadable)) {
      return fail('The file could not be read. It may be open in Excel or still being written. Close it, wait a moment, and try again.');
    }
    if (stage === 'Looking for the tracking-code column' && mode === 'missing-column') {
      return fail(
        `There is no "${getSettings().trackingColumn}" column in this file. Check the export settings, or change the column name in Settings.`,
      );
    }
  }
  return { ok: true, preview: buildPreview(meta, knownCodes(), getHistory(), rowsOf(meta)) };
}

/** Runs only after staff confirm the preview. */
export async function confirmImport(preview: ImportPreview): Promise<ImportRecord> {
  await wait(800);
  const now = new Date().toISOString();
  // Re-checked against the records now: another import may have added some of these codes since the preview.
  const fresh = buildPreview(preview, knownCodes(), getHistory(), rowsOf(preview));
  const record = recordFromPreview(fresh, now);
  addParcels(parcelsFromPreview(fresh, now));
  history = [record, ...getHistory()];
  return record;
}

export async function getMonitorState(mode: PreviewMode): Promise<MonitorState> {
  await wait(500);
  const settings = getSettings();
  const files = mode === 'empty' ? [] : folderFiles();
  const imported = mode === 'empty' ? [] : getHistory().filter((r) => r.source === 'folder');
  const activity: MonitorActivity[] = [
    ...files
      .filter((f) => f.status !== 'imported')
      .map((f) => ({
        at: f.modifiedAt,
        fileName: f.fileName,
        outcome: f.status === 'new' ? ('waiting' as const) : ('failed' as const),
        note: f.status === 'new' ? 'Waiting for review' : 'Cannot be read yet',
      })),
    ...imported.map((r) => ({
      at: r.importedAt,
      fileName: r.fileName,
      outcome: r.status,
      note: r.status === 'failed' ? 'Not imported' : `Imported after review, ${r.newRecords} new`,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const base: MonitorState = {
    folderPath: settings.watchedFolder,
    checkIntervalSeconds: settings.checkIntervalSeconds,
    status: 'preview',
    simulated: true,
    lastDetectedFile: activity[0]?.fileName ?? null,
    waiting: files.filter((f) => f.status === 'new').length,
    activity: activity.slice(0, 5),
  };
  if (mode === 'monitor-active') return { ...base, status: 'active' };
  if (mode === 'monitor-inactive' || (!settings.monitoringEnabled && mode !== 'monitor-error'))
    return { ...base, status: 'inactive', statusDetail: 'Automatic monitoring is off in Settings. Scan Folder Now still works.' };
  if (mode === 'monitor-error') {
    return {
      ...base,
      status: 'error',
      statusDetail: 'The watched folder cannot be reached. Check that the drive is connected, then scan again.',
    };
  }
  return base;
}
