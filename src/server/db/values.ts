// Value rules shared by the schema checks and the Phase 4 importer (docs/import-rules.md).

/** Trim surrounding whitespace, including non-breaking spaces, and nothing else. */
export const trimSource = (raw: string) => raw.replace(/^[\s ]+|[\s ]+$/g, '');

/**
 * Matching key for a trimmed tracking code (rule tracking-code-key/v1): ASCII a-z upper-cased, every other character
 * kept as it is. Same result as SQLite's built-in upper(); toUpperCase() is not used because it changes non-ASCII letters.
 */
export const trackingKey = (code: string) => code.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));

const SCAN_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const PHNOM_PENH_OFFSET_MS = 7 * 3600_000; // UTC+7, no daylight saving

/**
 * Parse a source `scan time` (rule scan-time-local/v1). Valid only for exactly `YYYY-MM-DD HH:MM:SS` naming a real date
 * and time in Asia/Phnom_Penh. Anything else returns null: the caller keeps the raw text and leaves the parsed fields null.
 */
export function parseScanTime(raw: string | null | undefined): { utc: string; date: string } | null {
  const m = typeof raw === 'string' ? SCAN_TIME.exec(raw) : null;
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const local = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const real =
    local.getUTCFullYear() === y && local.getUTCMonth() === mo - 1 && local.getUTCDate() === d &&
    local.getUTCHours() === h && local.getUTCMinutes() === mi && local.getUTCSeconds() === s;
  if (!real) return null;
  return { utc: new Date(local.getTime() - PHNOM_PENH_OFFSET_MS).toISOString(), date: raw!.slice(0, 10) };
}

export const nowIso = () => new Date().toISOString();
