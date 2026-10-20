// The settings table (docs/phase1-schema.md, table 13): one JSON value per key. Never secrets.
import type { Db } from './connection.ts';

export function readSetting(db: Db, key: string): unknown {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : undefined;
}

export const writeSetting = (db: Db, key: string, value: unknown, userId: number | null, at: string) =>
  db
    .prepare(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), userId, at);

/** The account is enabled and an admin. */
export const isAdmin = (db: Db, userId: number) =>
  !!(db.prepare('SELECT is_admin FROM users WHERE id = ? AND disabled = 0').get(userId) as { is_admin: number } | undefined)?.is_admin;
