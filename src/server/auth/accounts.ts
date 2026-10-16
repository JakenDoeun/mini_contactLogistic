// Staff accounts, login and logout. Audit entries carry the user's record ID and an error code only: never the
// username typed (it may be a mistyped password), the password, or the session token.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeAudit } from '../db/audit.ts';
import type { Db } from '../db/connection.ts';
import { dummyHash, hashPassword, normalizeUsername, validPassword, validUsername, verifyPassword } from './password.ts';
import { clearFailures, pausedFor, recordFailure } from './pause.ts';
import { createSession, endSession, endUserSessions, findSession } from './sessions.ts';

export type LoginResult =
  | { ok: true; token: string; userId: number }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'paused'; retryAfter: number };

const pauseKey = (username: string) => `user:${username.slice(0, 64)}`;

export async function logIn(db: Db, rawUsername: unknown, password: unknown, now = new Date()): Promise<LoginResult> {
  const username = normalizeUsername(rawUsername);
  const key = pauseKey(username);
  const t = now.getTime();
  const waiting = pausedFor(key, t);
  if (waiting) {
    writeAudit(db, { action: 'login.paused', entity: 'user', entityIds: [], outcome: 'refused', at: now.toISOString(), detail: { error_code: 'paused' } });
    return { ok: false, reason: 'paused', retryAfter: waiting };
  }
  const user = db.prepare('SELECT id, password_hash, disabled FROM users WHERE username = ?').get(username) as
    | { id: number; password_hash: string; disabled: number }
    | undefined;
  // Always one scrypt check, so a wrong username takes as long as a wrong password.
  const matches = typeof password === 'string' && password.length <= 1024 && (await verifyPassword(password, user?.password_hash ?? (await dummyHash())));
  if (!user || user.disabled || !matches) {
    const pause = recordFailure(key, t);
    writeAudit(db, {
      action: 'login.failed', entity: 'user', entityIds: user ? [user.id] : [], outcome: 'failed', at: now.toISOString(),
      detail: { error_code: 'invalid_credentials' },
    });
    return pause ? { ok: false, reason: 'paused', retryAfter: pause } : { ok: false, reason: 'invalid' };
  }
  clearFailures(key);
  const token = createSession(db, user.id, now);
  writeAudit(db, { action: 'login.succeeded', entity: 'user', entityIds: [user.id], outcome: 'ok', userId: user.id, at: now.toISOString() });
  return { ok: true, token, userId: user.id };
}

/** Ends the session behind this token, if any, and audits it. */
export function logOut(db: Db, token: unknown, now = new Date()): boolean {
  const user = findSession(db, token, now);
  if (!user || !endSession(db, token)) return false;
  writeAudit(db, { action: 'session.ended', entity: 'user', entityIds: [user.userId], outcome: 'ok', userId: user.userId, at: now.toISOString() });
  return true;
}

export const hasUsers = (db: Db) => db.prepare('SELECT 1 FROM users LIMIT 1').get() !== undefined;

export type CreateUserResult = { ok: true; userId: number } | { ok: false; reason: 'invalid_username' | 'invalid_password' | 'exists' };

/** Adds a staff account (first-run screen or scripts/user.ts). The first account is the admin (plan Revision 4). */
export async function createUser(db: Db, rawUsername: unknown, password: unknown, source: 'first_run' | 'cli', now = new Date(), onlyIfNoUsers = false): Promise<CreateUserResult> {
  const username = normalizeUsername(rawUsername);
  if (!validUsername(username)) return { ok: false, reason: 'invalid_username' };
  if (!validPassword(password)) return { ok: false, reason: 'invalid_password' };
  const hash = await hashPassword(password);
  return db.transaction((): CreateUserResult => {
    if (onlyIfNoUsers && hasUsers(db)) return { ok: false, reason: 'exists' };
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return { ok: false, reason: 'exists' };
    const userId = Number(
      db
        .prepare('INSERT INTO users (username, password_hash, created_at, is_admin) VALUES (?, ?, ?, NOT EXISTS (SELECT 1 FROM users))')
        .run(username, hash, now.toISOString()).lastInsertRowid,
    );
    writeAudit(db, { action: 'user.created', entity: 'user', entityIds: [userId], outcome: 'ok', at: now.toISOString(), detail: { source } });
    return { ok: true, userId };
  }).immediate();
}

/** Disables an account and ends all its sessions at once. */
export function disableUser(db: Db, rawUsername: unknown, now = new Date()): boolean {
  const username = normalizeUsername(rawUsername);
  return db.transaction(() => {
    const user = db.prepare('SELECT id FROM users WHERE username = ? AND disabled = 0').get(username) as { id: number } | undefined;
    if (!user) return false;
    db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(user.id);
    const ended = endUserSessions(db, user.id);
    writeAudit(db, { action: 'user.disabled', entity: 'user', entityIds: [user.id], outcome: 'ok', at: now.toISOString(), detail: { count: ended } });
    return true;
  })();
}

// ---- First run: the first account needs a one-time code that the server writes to its data folder ------------

export const FIRST_RUN_FILE = 'first-run-code.txt';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no 0/O, 1/I/L, U
const normalizeCode = (raw: unknown) => (typeof raw === 'string' ? raw.toUpperCase().replace(/[\s-]/g, '') : '');
const FIRST_RUN_KEY = 'first-run';

function newCode(): string {
  const chars = Array.from({ length: 16 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

/**
 * While no account exists, makes sure the code file exists (mode 0600, never overwritten) and returns its path.
 * Once an account exists, removes any leftover code file and returns null.
 */
export function ensureFirstRunCode(db: Db, dataDir: string): string | null {
  const file = path.join(dataDir, FIRST_RUN_FILE);
  if (hasUsers(db)) {
    fs.rmSync(file, { force: true });
    return null;
  }
  try {
    fs.writeFileSync(file, `${newCode()}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`First run: no account yet. Run \`npm run first-run-code\` on this computer to see the one-time code (kept in ${file}).`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  return file;
}

export type FirstAccountResult =
  | { ok: true; token: string; userId: number }
  | { ok: false; reason: 'exists' | 'bad_code' | 'invalid_username' | 'invalid_password' }
  | { ok: false; reason: 'paused'; retryAfter: number };

export async function createFirstAccount(
  db: Db, dataDir: string, code: unknown, rawUsername: unknown, password: unknown, now = new Date(),
): Promise<FirstAccountResult> {
  if (hasUsers(db)) return { ok: false, reason: 'exists' };
  const t = now.getTime();
  const waiting = pausedFor(FIRST_RUN_KEY, t);
  if (waiting) return { ok: false, reason: 'paused', retryAfter: waiting };
  const file = path.join(dataDir, FIRST_RUN_FILE);
  let expected = '';
  try {
    expected = normalizeCode(fs.readFileSync(file, 'utf8'));
  } catch {
    // no code file: nothing can match
  }
  const given = normalizeCode(code);
  const digest = (s: string) => crypto.createHash('sha256').update(s).digest();
  if (expected.length !== 16 || !crypto.timingSafeEqual(digest(given), digest(expected))) {
    const pause = recordFailure(FIRST_RUN_KEY, t);
    writeAudit(db, { action: 'user.first_run_refused', entity: 'user', entityIds: [], outcome: 'refused', at: now.toISOString(), detail: { error_code: 'bad_code' } });
    return pause ? { ok: false, reason: 'paused', retryAfter: pause } : { ok: false, reason: 'bad_code' };
  }
  const created = await createUser(db, rawUsername, password, 'first_run', now, true);
  if (!created.ok) return created;
  clearFailures(FIRST_RUN_KEY);
  fs.rmSync(file, { force: true });
  const token = createSession(db, created.userId, now);
  writeAudit(db, { action: 'login.succeeded', entity: 'user', entityIds: [created.userId], outcome: 'ok', userId: created.userId, at: now.toISOString(), detail: { source: 'first_run' } });
  return { ok: true, token, userId: created.userId };
}
