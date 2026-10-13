// npm run db:migrate — bring the database in DATA_DIR (default ~/.local/share/campus-branch) up to date.
import { prepareDatabase } from '../src/server/db/migrate.ts';
import { resolveDataDir } from '../src/server/db/paths.ts';

try {
  const dataDir = resolveDataDir();
  const result = await prepareDatabase(dataDir);
  console.log(`Database ready in ${dataDir}: ${result.applied} migration(s) applied${result.backupPath ? `, copy at ${result.backupPath}` : ''}.`);
} catch (e) {
  console.error(`Database migration failed: ${(e as Error).message}`);
  process.exit(1);
}
