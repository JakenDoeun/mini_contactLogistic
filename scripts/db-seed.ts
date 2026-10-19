// npm run db:seed — development only: fictional sample parcels into the development database.
import path from 'node:path';
import { openDatabase } from '../src/server/db/connection.ts';
import { prepareDatabase } from '../src/server/db/migrate.ts';
import { DEV_DATA_DIR, isInsideAny, PRODUCTION_DATA_DIRS, resolveDataDir } from '../src/server/db/paths.ts';
import { seedDemoData } from '../src/server/db/seed.ts';

try {
  // Refuse production before anything could create or open a database: by mode, and by real path (finding L1).
  if (process.env.NODE_ENV === 'production') throw new Error('refusing to seed demo data in production');
  const requested = path.resolve(process.env.DATA_DIR || DEV_DATA_DIR);
  if (isInsideAny(requested, PRODUCTION_DATA_DIRS)) throw new Error(`refusing to seed demo data into ${requested}`);
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
