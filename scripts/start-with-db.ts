// Start-up gate: migrate and self-test the database in DATA_DIR, and only then run the given command
// (e.g. `node scripts/start-with-db.ts next start -H 127.0.0.1 -p 3000`). Any failure: nothing is started, exit 1.
import { spawn } from 'node:child_process';
import { prepareDatabase } from '../src/server/db/migrate.ts';
import { resolveDataDir } from '../src/server/db/paths.ts';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/start-with-db.ts <command> [args...]');
  process.exit(2);
}

try {
  await prepareDatabase(resolveDataDir());
} catch (e) {
  console.error(`Database check failed; not starting "${command}": ${(e as Error).message}`);
  process.exit(1);
}

const child = spawn(command, args, { stdio: 'inherit' });
child.on('error', (e) => {
  console.error(`Could not start "${command}": ${e.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
