import Database from 'better-sqlite3';
import { assertOutsideProject } from './paths.ts';

export type Db = Database.Database;

/**
 * Open the branch database for normal use: WAL, foreign keys enforced, 5 s busy timeout.
 * The path must be absolute and outside the project folder.
 */
export function openDatabase(dbPath: string, options: { readonly?: boolean } = {}): Db {
  assertOutsideProject(dbPath);
  const db = new Database(dbPath, { readonly: options.readonly ?? false, fileMustExist: options.readonly ?? false });
  try {
    if (!options.readonly) {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
    }
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    if (db.pragma('foreign_keys', { simple: true }) !== 1) throw new Error('SQLite did not enable foreign keys');
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}
