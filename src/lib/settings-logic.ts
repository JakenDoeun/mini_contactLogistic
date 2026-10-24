// Pure settings shape and checks. No React, no I/O, so it runs under `node --test`.

/** The settings every staff member shares, kept on the server (Phase 10). The defaults are the server's. */
export interface Settings {
  trackingColumn: string;
  phoneColumn: string;
  /** What to do when a file with the same fingerprint was imported before. */
  duplicateFile: 'warn' | 'block';
  templates: { single: string; combined: string };
  /** The random wait between two SMS, in whole seconds. */
  smsGap: { from: number; to: number };
}

// Never under 15 seconds between two SMS (owner, 2026-10-23); 10 minutes is far past any useful pace.
export const SMS_GAP_LIMITS = { min: 15, max: 600 };

export const CHECK_INTERVALS = [30, 60, 120, 300];
const TOKENS = ['{name}', '{codes}', '{count}'];

export function folderError(path: string) {
  const p = path.trim();
  if (!p) return 'Enter the folder the logistics system exports to.';
  // Windows drive, network share, or a Unix-style absolute path.
  if (!/^([A-Za-z]:\\|\\\\[^\\]+\\|\/)/.test(p)) return 'Use the full path, for example D:\\Logistics\\Exports or \\\\server\\exports.';
  return null;
}

export function templateError(text: string) {
  if (!text.trim()) return 'The message cannot be empty.';
  const unknown = (text.match(/\{[^}]*\}/g) ?? []).find((t) => !TOKENS.includes(t));
  if (unknown) return `${unknown} is not a placeholder. Use {name}, {codes} or {count}.`;
  if (!text.includes('{codes}')) return 'Include {codes} so the customer knows which parcels arrived.';
  return null;
}

export function gatewayUrlError(url: string) {
  if (!url.trim()) return null; // npm run gateway asks for it separately
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? null : 'Use an http:// or https:// address.';
  } catch {
    return 'Enter the full address, for example http://192.168.1.20:8080.';
  }
}

export function gapError(gap: { from: number; to: number }) {
  const { min, max } = SMS_GAP_LIMITS;
  const ok = (n: number) => Number.isInteger(n) && n >= min && n <= max;
  if (!ok(gap.from) || !ok(gap.to)) return `Use whole seconds from ${min} to ${max}.`;
  if (gap.to < gap.from) return 'The longest wait cannot be shorter than the shortest.';
  return null;
}

export const columnError = (name: string) => (name.trim() ? null : 'Enter the column heading exactly as it appears in the export.');
