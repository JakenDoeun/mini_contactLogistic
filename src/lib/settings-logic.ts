// Pure settings shape and checks. No React, no I/O, so it runs under `node --test`.
import type { Message } from './messages.ts';

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

// Each check returns a message key (translated where it is shown) or null when the value is fine.
export function folderError(path: string): Message | null {
  const p = path.trim();
  if (!p) return { key: 'settingsError.folderEmpty' };
  // Windows drive, network share, or a Unix-style absolute path.
  if (!/^([A-Za-z]:\\|\\\\[^\\]+\\|\/)/.test(p)) return { key: 'settingsError.folderPath' };
  return null;
}

export function templateError(text: string): Message | null {
  if (!text.trim()) return { key: 'settingsError.templateEmpty' };
  const unknown = (text.match(/\{[^}]*\}/g) ?? []).find((t) => !TOKENS.includes(t));
  // {token} is filled; the {name}, {codes} and {count} in the sentence stay as written.
  if (unknown) return { key: 'settingsError.templateUnknown', vars: { token: unknown } };
  if (!text.includes('{codes}')) return { key: 'settingsError.templateCodes' };
  return null;
}

export function gatewayUrlError(url: string): Message | null {
  if (!url.trim()) return null; // npm run gateway asks for it separately
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? null : { key: 'settingsError.urlScheme' };
  } catch {
    return { key: 'settingsError.urlFull' };
  }
}

export function gapError(gap: { from: number; to: number }): Message | null {
  const { min, max } = SMS_GAP_LIMITS;
  const ok = (n: number) => Number.isInteger(n) && n >= min && n <= max;
  if (!ok(gap.from) || !ok(gap.to)) return { key: 'settingsError.gapRange', vars: { min, max } };
  if (gap.to < gap.from) return { key: 'settingsError.gapOrder' };
  return null;
}

export const columnError = (name: string): Message | null => (name.trim() ? null : { key: 'settingsError.column' });
