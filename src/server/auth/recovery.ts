// Password recovery code (docs/phase2-login.md, "Recovery code"). Separate from the first-run code: its own file, its own
// table, its own pause counter.
// The database decides whether a code is valid: `recovery_codes` holds only the SHA-256 of the active code, and a row once
// ended (used, rotated, revoked) never validates again. The file in the data folder only lets the office read the code
// back; if it is stale or missing, nothing is valid that the database does not say is valid, and no code is ever created
// except by an explicit rotate. Neither the code nor its hash reaches an API response, a log line or the audit log.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeAudit } from '../db/audit.ts';
import type { Db } from '../db/connection.ts';
import { hashPassword, normalizeUsername, validPassword } from './password.ts';
import { clearFailures, pausedFor, recordFailure } from './pause.ts';
import { endUserSessions } from './sessions.ts';

export const RECOVERY_FILE = 'recovery-code.txt';
export const RECOVERY_BYTES = 20; // 160 bits = exactly 32 Crockford Base32 characters
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_SHAPE = /^[0-9A-HJKMNP-TV-Z]{32}$/;
const PAUSE_KEY = 'recovery'; // one code for the installation, so one counter

/** 20 random bytes as 32 Crockford Base32 characters (5 bits each, most significant first). */
export function encodeCrockford(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

/** Eight groups of four, e.g. `7K3M-…`. */
export const formatCode = (code: string) => code.match(/.{4}/g)!.join('-');

/** Typed input to the canonical 32 characters, or '' if it cannot be a code. Crockford: O→0, I/L→1, case-insensitive. */
export function normalizeRecoveryCode(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 128) return '';
  const code = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return CODE_SHAPE.test(code) ? code : '';
}

export const newRecoveryCode = (random: (n: number) => Buffer = crypto.randomBytes) => encodeCrockford(random(RECOVERY_BYTES));
const hashCode = (code: string) => crypto.createHash('sha256').update(code).digest('hex');
const activeRow = (db: Db) =>
  db.prepare('SELECT id, code_hash FROM recovery_codes WHERE ended_at IS NULL').get() as { id: number; code_hash: string } | undefined;
const sameHash = (a: string, b: string) => crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

function endActive(db: Db, reason: 'rotated' | 'revoked', at: string): number | null {
  const row = activeRow(db);
  if (!row) return null;
  db.prepare('UPDATE recovery_codes SET ended_at = ?, end_reason = ? WHERE id = ?').run(at, reason, row.id);
  return row.id;
}

/**
 * Replaces the active code (if any) with a new one. The new code goes to a 0600 temporary file first, the database
 * switches over in one transaction, then the file is renamed into place.
 * - Failure before the commit: nothing changes; the old code and its file stay valid.
 * - Failure after the commit (rename fails, or the process stops): fails closed. The old code is already ended, the new
 *   one is in no readable file, so no code works for anyone and `show` refuses. The remedy is another rotate, which
 *   first removes temporary files left by a stopped run.
 */
export function rotateRecoveryCode(db: Db, dataDir: string, now = new Date(), random?: (n: number) => Buffer): void {
  removeTempFiles(dataDir);
  const code = newRecoveryCode(random);
  const file = path.join(dataDir, RECOVERY_FILE);
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${formatCode(code)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    const at = now.toISOString();
    db.transaction(() => {
      const ended = endActive(db, 'rotated', at);
      const id = Number(db.prepare('INSERT INTO recovery_codes (code_hash, created_at) VALUES (?, ?)').run(hashCode(code), at).lastInsertRowid);
      writeAudit(db, { action: 'recovery_code.rotated', entity: 'recovery_code', entityIds: ended ? [ended, id] : [id], outcome: 'ok', at });
    }).immediate();
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`the new code is active but could not be saved (${(e as Error).message}); no code can be shown or used now. Run npm run recovery-code -- rotate again`, { cause: e });
  }
}

const TEMP_FILE = /^recovery-code\.txt\.[0-9a-f]{12}\.tmp$/; // RECOVERY_FILE + the suffix rotate adds
/** Temporary files left by a rotate that stopped between its database commit and the rename. */
function removeTempFiles(dataDir: string) {
  for (const name of fs.readdirSync(dataDir)) if (TEMP_FILE.test(name)) fs.rmSync(path.join(dataDir, name), { force: true });
}

/** Ends the active code without a replacement. Returns false if there was none. */
export function revokeRecoveryCode(db: Db, dataDir: string, now = new Date()): boolean {
  const at = now.toISOString();
  const ended = db.transaction(() => {
    const id = endActive(db, 'revoked', at);
    if (id) writeAudit(db, { action: 'recovery_code.revoked', entity: 'recovery_code', entityIds: [id], outcome: 'ok', at });
    return id;
  }).immediate();
  removeFile(dataDir);
  removeTempFiles(dataDir);
  return ended !== null;
}

export type ShowResult = { ok: true; code: string } | { ok: false; reason: 'none' | 'file_missing' | 'file_stale' };

/** The active code, read back from its file and checked against the database. Never creates one. */
export function readActiveRecoveryCode(db: Db, dataDir: string): ShowResult {
  const row = activeRow(db);
  let code = '';
  try {
    code = normalizeRecoveryCode(fs.readFileSync(path.join(dataDir, RECOVERY_FILE), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    return { ok: false, reason: row ? 'file_missing' : 'none' };
  }
  if (!row) {
    removeFile(dataDir); // a used or revoked code left behind by a failed cleanup
    return { ok: false, reason: 'none' };
  }
  if (!code || !sameHash(hashCode(code), row.code_hash)) return { ok: false, reason: 'file_stale' };
  return { ok: true, code: formatCode(code) };
}

function removeFile(dataDir: string): boolean {
  try {
    fs.rmSync(path.join(dataDir, RECOVERY_FILE), { force: true });
    return true;
  } catch {
    return false; // the database already ended the code; a leftover file validates nothing
  }
}

export type RecoverResult =
  | { ok: true; userId: number }
  | { ok: false; reason: 'invalid' | 'invalid_password' }
  | { ok: false; reason: 'paused'; retryAfter: number };

class Raced extends Error {}

/**
 * Sets a new password with the recovery code. On success, in one transaction: the password changes, the code is
 * marked used and every session of the account ends. A wrong code, an unknown or disabled account, or a code already
 * used all get the same answer, count towards the pause, and leave the code as it was.
 */
export async function recoverPassword(
  db: Db, dataDir: string, rawUsername: unknown, rawCode: unknown, newPassword: unknown, now = new Date(),
): Promise<RecoverResult> {
  const t = now.getTime();
  const at = now.toISOString();
  const waiting = pausedFor(PAUSE_KEY, t);
  if (waiting) {
    writeAudit(db, { action: 'user.recovery_refused', entity: 'user', entityIds: [], outcome: 'refused', at, detail: { error_code: 'paused' } });
    return { ok: false, reason: 'paused', retryAfter: waiting };
  }
  if (!validPassword(newPassword)) return { ok: false, reason: 'invalid_password' };
  const code = normalizeRecoveryCode(rawCode);
  const row = activeRow(db);
  const user = db.prepare('SELECT id, disabled FROM users WHERE username = ?').get(normalizeUsername(rawUsername)) as
    | { id: number; disabled: number }
    | undefined;
  const fail = (): RecoverResult => {
    const pause = recordFailure(PAUSE_KEY, t);
    writeAudit(db, { action: 'user.recovery_refused', entity: 'user', entityIds: [], outcome: 'failed', at, detail: { error_code: 'invalid_recovery' } });
    return pause ? { ok: false, reason: 'paused', retryAfter: pause } : { ok: false, reason: 'invalid' };
  };
  if (!row || !code || !sameHash(hashCode(code), row.code_hash) || !user || user.disabled) return fail();

  const hash = await hashPassword(newPassword);
  try {
    db.transaction(() => {
      // Re-checked inside the write lock: a concurrent request may have used, rotated or revoked the code meanwhile.
      if (db.prepare("UPDATE recovery_codes SET ended_at = ?, end_reason = 'used', used_by = ? WHERE id = ? AND ended_at IS NULL").run(at, user.id, row.id).changes !== 1) throw new Raced();
      if (db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND disabled = 0').run(hash, user.id).changes !== 1) throw new Raced();
      const count = endUserSessions(db, user.id);
      writeAudit(db, { action: 'user.password_recovered', entity: 'user', entityIds: [user.id], outcome: 'ok', at, detail: { count } });
    }).immediate();
  } catch (e) {
    if (e instanceof Raced) return fail();
    throw e;
  }
  clearFailures(PAUSE_KEY);
  removeFile(dataDir);
  return { ok: true, userId: user.id };
}
