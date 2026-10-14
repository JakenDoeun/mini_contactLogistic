// npm run user -- add <username>      add a staff account; prints a generated password once
// npm run user -- disable <username>  disable an account and end all its sessions
// Run on the office computer; uses the database in DATA_DIR (default ~/.local/share/campus-branch).
import crypto from 'node:crypto';
import path from 'node:path';
import { createUser, disableUser } from '../src/server/auth/accounts.ts';
import { openVerifiedDatabase } from '../src/server/db/migrate.ts';
import { resolveDataDir } from '../src/server/db/paths.ts';

const [command, username] = process.argv.slice(2);
if (!['add', 'disable'].includes(command) || !username) {
  console.error('Usage: npm run user -- add <username> | disable <username>');
  process.exit(2);
}

try {
  const db = openVerifiedDatabase(path.join(resolveDataDir(), 'branch.db'));
  try {
    if (command === 'add') {
      const password = crypto.randomBytes(15).toString('base64url'); // 20 characters
      const result = await createUser(db, username, password, 'cli');
      if (!result.ok) throw new Error(result.reason);
      console.log(`Account ${username.trim().toLowerCase()} created. Password (shown once, give it to the staff member):\n${password}`);
    } else if (!disableUser(db, username)) {
      throw new Error('no active account with that username');
    } else {
      console.log(`Account ${username.trim().toLowerCase()} disabled; its sessions have ended.`);
    }
  } finally {
    db.close();
  }
} catch (e) {
  console.error(`user ${command} failed: ${(e as Error).message}`);
  process.exit(1);
}
