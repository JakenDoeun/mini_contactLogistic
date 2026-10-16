// Staff sessions in the `sessions` table. The browser holds a random token; the database holds only its SHA-256, so a
// copy of the database or a backup cannot be used to sign in.
import crypto from 'node:crypto';
import type { Db } from '../db/connection.ts';

// Plan decision 9 (owner, 2026-10-14): internal, Tailscale-only app, so longer sessions for staff convenience. Signed
// out after 7 days without use, and 30 days after sign-in in any case; use never moves that 30-day deadline.
export const SESSION_IDLE_MS = 7 * 24 * 3600_000;
export const SESSION_MAX_MS = 30 * 24 * 3600_000;
const TOUCH_MS = 60_000; // last_seen_at is written at most once a minute per session

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export interface SessionUser {
  userId: number;
  username: string;
  isAdmin: boolean;
}

function purgeExpired(db: Db, now: Date) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?').run(
    now.toISOString(),
    new Date(now.getTime() - SESSION_IDLE_MS).toISOString(),
  );
}

export function createSession(db: Db, userId: number, now = new Date()): string {
  purgeExpired(db, now);
  const token = crypto.randomBytes(32).toString('base64url');
  const at = now.toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(
    hashToken(token), userId, at, new Date(now.getTime() + SESSION_MAX_MS).toISOString(), at,
  );
  return token;
}

/** The signed-in user for a token, or null. An expired session, or one of a disabled account, is deleted. */
export function findSession(db: Db, token: unknown, now = new Date()): SessionUser | null {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return null;
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT s.user_id, s.expires_at, s.last_seen_at, u.username, u.disabled, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as { user_id: number; expires_at: string; last_seen_at: string; username: string; disabled: number; is_admin: number } | undefined;
  if (!row) return null;
  const t = now.getTime();
  const lastSeen = Date.parse(row.last_seen_at);
  if (row.disabled || Date.parse(row.expires_at) <= t || lastSeen + SESSION_IDLE_MS <= t) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  if (t - lastSeen >= TOUCH_MS) db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now.toISOString(), tokenHash);
  return { userId: row.user_id, username: row.username, isAdmin: row.is_admin === 1 };
}

export function endSession(db: Db, token: unknown): boolean {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return false;
  return db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token)).changes > 0;
}

export const endUserSessions = (db: Db, userId: number) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
