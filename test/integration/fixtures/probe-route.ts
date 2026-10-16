// Test-only route, copied into the integration build copy and never into the app: reports how the server bundle
// resolves the project and migration folders, and whether openVerifiedDatabase accepts the current database.
import path from 'node:path';
import { MigrationError, openVerifiedDatabase } from '@/server/db/migrate';
import { MIGRATIONS_FOLDER, PROJECT_ROOT, resolveDataDir } from '@/server/db/paths';

export async function GET() {
  const dbPath = path.join(resolveDataDir(), 'branch.db');
  const result: Record<string, unknown> = { projectRoot: PROJECT_ROOT, migrationsFolder: MIGRATIONS_FOLDER, cwd: process.cwd() };
  try {
    const db = openVerifiedDatabase(dbPath);
    result.ok = true;
    result.migrations = (db.prepare('SELECT count(*) AS n FROM "__drizzle_migrations"').get() as { n: number }).n;
    db.close();
  } catch (e) {
    result.ok = false;
    result.code = e instanceof MigrationError ? e.code : 'other';
    result.message = (e as Error).message;
  }
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
