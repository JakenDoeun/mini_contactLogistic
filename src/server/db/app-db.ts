// The web app's database handle: opened once per server process, and only if every committed migration is applied
// and the self-test passes (openVerifiedDatabase). Kept on globalThis so `next dev` reloads reuse one connection.
import path from 'node:path';
import type { Db } from './connection.ts';
import { openVerifiedDatabase } from './migrate.ts';
import { resolveDataDir } from './paths.ts';

const holder = globalThis as { __campusBranchDb?: Db };

export function appDb(): Db {
  if (holder.__campusBranchDb?.open) return holder.__campusBranchDb;
  holder.__campusBranchDb = openVerifiedDatabase(path.join(resolveDataDir(), 'branch.db'));
  return holder.__campusBranchDb;
}
