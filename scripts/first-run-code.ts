// npm run first-run-code — shows the one-time code for the first account, in this terminal only, while no account
// exists. It reads the code file in the data folder (DATA_DIR, default ~/.local/share/campus-branch); it never replaces
// an existing code. Once an account exists it refuses, and the leftover file (if any) is removed.
import fs from 'node:fs';
import path from 'node:path';
import { ensureFirstRunCode } from '../src/server/auth/accounts.ts';
import { openVerifiedDatabase } from '../src/server/db/migrate.ts';
import { resolveDataDir } from '../src/server/db/paths.ts';

if (!process.stdout.isTTY) {
  console.error('Refusing to print the one-time code into a pipe or a file. Run npm run first-run-code in a terminal.');
  process.exit(1);
}

try {
  const dataDir = resolveDataDir();
  const db = openVerifiedDatabase(path.join(dataDir, 'branch.db'));
  try {
    const file = ensureFirstRunCode(db, dataDir);
    if (!file) {
      console.error('First-time setup is complete: an account exists, so there is no one-time code to show.');
      process.exit(1);
    }
    const code = fs.readFileSync(file, 'utf8').trim();
    console.log(`\nOne-time code for the first account:\n\n    ${code}\n\nType it on the sign-in page. It works once.\n`);
  } finally {
    db.close();
  }
} catch (e) {
  console.error(`first-run-code failed: ${(e as Error).message}`);
  process.exit(1);
}
