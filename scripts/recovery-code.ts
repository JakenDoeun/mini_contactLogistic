// npm run recovery-code -- show     print the active password recovery code (terminal only)
// npm run recovery-code -- rotate   replace it with a new one (the old one stops working at once)
// npm run recovery-code -- revoke   end it without a replacement
// Run on the office computer; uses the data folder in DATA_DIR (default ~/.local/share/campus-branch). `show` never
// creates a code: there is none until the first `rotate`. Separate from `npm run first-run-code`.
import path from 'node:path';
import { readActiveRecoveryCode, revokeRecoveryCode, rotateRecoveryCode } from '../src/server/auth/recovery.ts';
import { openVerifiedDatabase } from '../src/server/db/migrate.ts';
import { resolveDataDir } from '../src/server/db/paths.ts';

const [command] = process.argv.slice(2);
if (!['show', 'rotate', 'revoke'].includes(command)) {
  console.error('Usage: npm run recovery-code -- show | rotate | revoke');
  process.exit(2);
}
if (command === 'show' && !process.stdout.isTTY) {
  console.error('Refusing to print the recovery code into a pipe or a file. Run npm run recovery-code -- show in a terminal.');
  process.exit(1);
}

const NOT_SHOWN = {
  none: 'There is no active recovery code. Create one with: npm run recovery-code -- rotate',
  file_missing: 'A recovery code is active but its file is missing, so it cannot be shown. Replace it with: npm run recovery-code -- rotate',
  file_stale: 'The recovery code file does not match the active code, so it is not shown. Replace it with: npm run recovery-code -- rotate',
};

try {
  const dataDir = resolveDataDir();
  const db = openVerifiedDatabase(path.join(dataDir, 'branch.db'));
  try {
    if (command === 'show') {
      const result = readActiveRecoveryCode(db, dataDir);
      if (!result.ok) {
        console.error(NOT_SHOWN[result.reason]);
        process.exit(1);
      }
      console.log(`\nPassword recovery code:\n\n    ${result.code}\n\nIt resets one account's password once, then stops working. Keep it somewhere safe and offline.\n`);
    } else if (command === 'rotate') {
      rotateRecoveryCode(db, dataDir);
      console.log('New recovery code created; any earlier code no longer works. See it with: npm run recovery-code -- show');
    } else {
      console.log(revokeRecoveryCode(db, dataDir) ? 'Recovery code revoked. There is no active code now.' : 'There was no active recovery code.');
    }
  } finally {
    db.close();
  }
} catch (e) {
  console.error(`recovery-code ${command} failed: ${(e as Error).message}`);
  process.exit(1);
}
