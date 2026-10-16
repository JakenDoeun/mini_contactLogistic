import Database from 'better-sqlite3';
import { assertOutsideProject } from './paths.ts';

export type Db = Database.Database;

/**
 * Open the branch database for normal use: WAL, foreign keys enforced, 5 s busy timeout.
 * synchronous = FULL: a record the app reports as saved survives a power cut (NORMAL can lose the last commits).
 * secure_delete: deleted rows are overwritten, so expired customer data does not linger in free pages (Revision 4).
 * The path must be absolute and outside the project folder.
 */
export function openDatabase(dbPath: string, options: { readonly?: boolean; mustExist?: boolean } = {}): Db {
  assertOutsideProject(dbPath);
  const db = new Database(dbPath, { readonly: options.readonly ?? false, fileMustExist: (options.readonly || options.mustExist) ?? false });
  try {
    if (!options.readonly) {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = FULL');
    }
    db.pragma('secure_delete = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    if (db.pragma('foreign_keys', { simple: true }) !== 1) throw new Error('SQLite did not enable foreign keys');
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}
