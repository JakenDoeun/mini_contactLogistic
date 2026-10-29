// The Windows updater's helpers. deploy/windows/update.ps1 and install.ps1 run them with the app's own Node.js and
// DATA_DIR set; the decisions live here so they are tested (src/lib/versions.ts, src/server/update/switch.ts).
//   latest <owner/repo> <office|test>   prints the newest published release newer than this version, or nothing
//   busy                                exit 3 while an SMS is being handed to the phone or a batch is sending
//   backup                              saves a backup now (the app is stopped) and prints its file
//   db-newer <drizzle folder>           exit 3 when the database has migrations that folder's version does not know
//   pre-migration                       prints scripts/restore.ts's number for the newest pre-migration copy
import fs from 'node:fs';
import path from 'node:path';
import { saveBackup } from '../src/server/db/backup.ts';
import { openDatabase } from '../src/server/db/connection.ts';
import { resolveDataDir } from '../src/server/db/paths.ts';
import { databaseNewer, newestPreMigration, smsBusy } from '../src/server/update/switch.ts';
import { pickRelease, type Channel, type GithubRelease } from '../src/lib/versions.ts';

const fail = (message: string): never => {
  console.error(`update: ${message}`);
  process.exit(1);
};
const [command, ...args] = process.argv.slice(2);
const dbPath = () => path.join(resolveDataDir(), 'branch.db');
const withDb = <T>(readonly: boolean, use: (db: ReturnType<typeof openDatabase>) => T) => {
  const db = openDatabase(dbPath(), { readonly, mustExist: true });
  try {
    return use(db);
  } finally {
    db.close();
  }
};

try {
  if (command === 'latest') {
    const [repo, channel] = args;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || (channel !== 'office' && channel !== 'test')) fail('usage: latest <owner/repo> <office|test>');
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'campus-branch-updater' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) fail(`GitHub answered ${res.status}`);
    const installed = (JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;
    const tag = pickRelease((await res.json()) as GithubRelease[], installed, channel as Channel);
    if (tag) console.log(tag);
  } else if (command === 'busy') {
    if (withDb(true, (db) => smsBusy(db))) process.exit(3);
  } else if (command === 'backup') {
    const saved = withDb(false, (db) => saveBackup(db, resolveDataDir()));
    console.log(saved.saved ? saved.path : 'unchanged since the last backup');
  } else if (command === 'db-newer') {
    if (!args[0] || !fs.existsSync(args[0])) fail('usage: db-newer <drizzle folder>');
    if (withDb(true, (db) => databaseNewer(db, args[0]))) process.exit(3);
  } else if (command === 'pre-migration') {
    const n = newestPreMigration(resolveDataDir());
    if (n === null) fail('there is no pre-migration copy');
    console.log(n);
  } else {
    fail('usage: latest | busy | backup | db-newer | pre-migration');
  }
} catch (e) {
  fail((e as Error).message);
}
