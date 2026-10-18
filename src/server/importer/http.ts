// Request parsing shared by the /api/imports routes.
import type { DateChoice } from './check.ts';

/** The numeric ID after `segment` in the request path, e.g. /api/imports/<id>/confirm. */
export function idAfter(req: Request, segment: string): number | null {
  const parts = new URL(req.url).pathname.split('/');
  const n = Number(parts[parts.indexOf(segment) + 1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** A date choice from a query string or JSON body: single_scan_date, all_on_batch_date, or only_scan_date + date. */
export function parseDateChoice(kind: unknown, date: unknown): DateChoice | null {
  if (kind === 'single_scan_date' || kind === 'all_on_batch_date') return { kind };
  if (kind === 'only_scan_date' && typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return { kind, date };
  return null;
}
