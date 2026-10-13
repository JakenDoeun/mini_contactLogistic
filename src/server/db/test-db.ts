// Test isolation (docs/phase1-schema.md, "Tests"): every test database lives in its own folder under the system
// temporary directory and is deleted afterwards. Tests never read DATA_DIR or the development data folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type Db } from './connection.ts';
import { migrateDatabase } from './migrate.ts';
import { assertInTempDir } from './paths.ts';

export function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-'));
  assertInTempDir(dir);
  return dir;
}

export function removeTempDir(dir: string) {
  assertInTempDir(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

/** A migrated database in a fresh temporary folder. Call cleanup() (e.g. via t.after) when done. */
export async function createTestDb(migrationsFolder?: string): Promise<{ db: Db; dir: string; dbPath: string; cleanup: () => void }> {
  const dir = makeTempDir();
  const dbPath = path.join(dir, 'branch.db');
  await migrateDatabase({ dbPath, backupDir: path.join(dir, 'backups'), migrationsFolder });
  const db = openDatabase(dbPath);
  return {
    db,
    dir,
    dbPath,
    cleanup: () => {
      if (db.open) db.close();
      removeTempDir(dir);
    },
  };
}
