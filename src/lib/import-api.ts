// Browser side of /api/imports (Phase 4). The server reads the file and decides every count; this only carries
// requests and turns error codes into sentences staff can act on.
import type { BrowseResult, DetectedFile, folderState, ScanResult } from '@/server/folder/folder';
import type { ImportListItem, Review } from '@/server/importer/store';

export type { DetectedFile, ImportListItem, Review, ScanResult };
export type FolderState = ReturnType<typeof folderState> & { isAdmin: boolean };
export type ReviewItem = Review['items'][number];
export type DateChoice = { kind: 'single_scan_date' } | { kind: 'all_on_batch_date' } | { kind: 'only_scan_date'; date: string };

const MESSAGES: Record<string, string> = {
  unauthorized: 'Your session has ended. Sign in again, then retry.',
  too_large: 'The file is larger than 10 MB. Export a shorter date range.',
  no_file: 'The file was empty when it arrived. Choose it again.',
  cross_site: 'This request came from another site and was refused. Open the branch address directly.',
  not_found: 'This import no longer exists.',
  not_checked: 'This import was already confirmed or discarded.',
  not_waiting: 'This file was already reviewed or taken off the list.',
  frozen: 'This import was already confirmed or discarded, so its decisions can no longer change.',
  database_unavailable: 'The branch database is not available right now. Try again in a minute.',
};

async function call<T>(url: string, init?: RequestInit, accept: number[] = []): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    throw new Error('The branch app could not be reached. Check the connection, then try again.');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok || accept.includes(res.status)) return body as T;
  const code = res.status === 401 ? 'unauthorized' : String(body.error ?? '');
  throw new Error(
    MESSAGES[code] ||
      (typeof body.message === 'string' && body.message) ||
      (Array.isArray(body.messages) && body.messages.join(' ')) ||
      `The request failed (${res.status}). Try again.`,
  );
}

const send = (body: unknown): RequestInit => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const listImports = () => call<{ imports: ImportListItem[] }>('/api/imports').then((r) => r.imports);

/** Upload and check. A file that fails its checks still gets an import ID (status failed), so it shows in history. */
export function checkFile(file: File) {
  const form = new FormData();
  form.append('file', file);
  return call<{ importId: number; status: 'checked' | 'no_eligible_rows' | 'failed'; message?: string }>(
    '/api/imports/check',
    { method: 'POST', body: form },
    [422],
  );
}

export function getReview(id: number, choice: DateChoice | null) {
  const q = !choice ? '' : `?choice=${choice.kind}${choice.kind === 'only_scan_date' ? `&date=${choice.date}` : ''}`;
  return call<Review>(`/api/imports/${id}${q}`);
}

export const decide = (itemId: number, decision: { resolution: 'left_out' } | { resolution: 'chosen'; chosen: Record<string, string> }) =>
  call<{ ok: true }>(`/api/imports/review-items/${itemId}`, { method: 'PUT', ...send(decision) });

export const cancelImport = (id: number) => call<{ ok: true }>(`/api/imports/${id}/cancel`, { method: 'POST', ...send({}) });

export const confirmImport = (id: number, body: { arrivalBatchDate: string; dateChoice: DateChoice; batchDateChosen: boolean }) =>
  call<{ ok: true; added: number }>(`/api/imports/${id}/confirm`, {
    method: 'POST',
    ...send({
      arrivalBatchDate: body.arrivalBatchDate,
      dateChoice: body.dateChoice.kind,
      chosenScanDate: body.dateChoice.kind === 'only_scan_date' ? body.dateChoice.date : undefined,
      batchDateChosen: body.batchDateChosen,
    }),
  });

// ---- The watched folder (Phase 5) ----

export const getFolder = () => call<FolderState>('/api/folder');
export const scanFolder = () => call<FolderState & { result: ScanResult }>('/api/folder/scan', { method: 'POST', ...send({}) });
export const checkFolderFile = (id: number) => call<{ ok: true; importId: number }>(`/api/folder/files/${id}/check`, { method: 'POST', ...send({}) });
export const dismissFolderFile = (id: number) => call<{ ok: true }>(`/api/folder/files/${id}/dismiss`, { method: 'POST', ...send({}) });
/** null = start at home; '' = the top level (drives). */
export const browseFolder = (at: string | null) =>
  call<Extract<BrowseResult, { ok: true }>>(`/api/folder/browse${at === null ? '' : `?path=${encodeURIComponent(at)}`}`);
export const saveFolderSettings =(body: { path: string; auto: boolean; intervalSeconds: number }) =>
  call<FolderState>('/api/settings/folder', { method: 'PUT', ...send(body) });
