// npm run db:seed — development only: fictional sample parcels into the development database.
import path from 'node:path';
import { openDatabase } from '../src/server/db/connection.ts';
import { prepareDatabase } from '../src/server/db/migrate.ts';
import { DEV_DATA_DIR, PRODUCTION_DATA_DIR, resolveDataDir } from '../src/server/db/paths.ts';
import { seedDemoData } from '../src/server/db/seed.ts';

try {
  // Refuse the production folder before anything could create or open it.
  const requested = path.resolve(process.env.DATA_DIR || DEV_DATA_DIR);
  const rel = path.relative(PRODUCTION_DATA_DIR, requested);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error(`refusing to seed demo data into ${requested}`);
  const dataDir = resolveDataDir();
  await prepareDatabase(dataDir);
  const db = openDatabase(path.join(dataDir, 'branch.db'));
  try {
    const result = seedDemoData(db);
    console.log(result.seeded ? `Seeded ${result.parcels} sample parcels in ${result.imports} demo imports.` : `Nothing to do: ${result.reason}.`);
  } finally {
    db.close();
  }
} catch (e) {
  console.error(`Demo seed failed: ${(e as Error).message}`);
  process.exit(1);
}
