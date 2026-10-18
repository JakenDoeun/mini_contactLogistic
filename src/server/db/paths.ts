import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (this file is src/server/db/paths.ts). */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const MIGRATIONS_FOLDER = path.join(PROJECT_ROOT, 'drizzle');
export const DEV_DATA_DIR = path.join(os.homedir(), '.local/share/campus-branch');
export const PRODUCTION_DATA_DIR = '/var/lib/campus-branch';
/** Where installed copies keep their data: the Linux folder, and the Windows one (deploy/windows/install.ps1). */
export const PRODUCTION_DATA_DIRS = [PRODUCTION_DATA_DIR, path.join(process.env.ProgramData || 'C:\\ProgramData', 'CampusBranch')];

const realOrResolved = (p: string) => {
  const abs = path.resolve(p);
  // Resolve the deepest existing ancestor, so symlinks cannot hide a path inside the project.
  let existing = abs;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  return path.join(fs.realpathSync(existing), path.relative(existing, abs));
};
const isInside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** The project folder is on NTFS with allow_other: a database there would be readable by every local account. */
export function assertOutsideProject(dbPath: string) {
  if (!path.isAbsolute(dbPath)) throw new Error(`Database path must be absolute: ${dbPath}`);
  if (isInside(realOrResolved(dbPath), fs.realpathSync(PROJECT_ROOT))) {
    throw new Error(`Refusing a database inside the project folder: ${dbPath}`);
  }
}

/** `dir` is, or is inside, one of `roots`, comparing real paths, so a symlink or bind mount cannot hide it (finding L1). */
export const isInsideAny = (dir: string, roots: string[]) => roots.some((root) => isInside(realOrResolved(dir), realOrResolved(root)));

/** Tests may only use databases under the system temporary folder, and never inside the project (even a checkout in /tmp). */
export function assertInTempDir(p: string) {
  const real = realOrResolved(p);
  if (!isInside(real, fs.realpathSync(os.tmpdir())) || isInside(real, fs.realpathSync(PROJECT_ROOT))) {
    throw new Error(`Test databases must live under ${os.tmpdir()}, outside the project: ${p}`);
  }
}

/** Data folder for the scripts: DATA_DIR, else the development folder. Created 0700; refused if others can read it. */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env) {
  // Finding M2: a production server without DATA_DIR must not quietly use the development folder.
  if (!env.DATA_DIR?.trim() && env.NODE_ENV === 'production') {
    throw new Error('DATA_DIR is not set: a production server needs its data folder named (npm run serve passes it).');
  }
  // The data folder is outside the project, so Turbopack need not trace the project for these calls.
  const dir = path.resolve(/*turbopackIgnore: true*/ env.DATA_DIR || DEV_DATA_DIR);
  assertOutsideProject(path.join(dir, 'branch.db'));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const mode = fs.statSync(/*turbopackIgnore: true*/ dir).mode & 0o777;
  if (process.platform !== 'win32' && mode & 0o077) {
    throw new Error(`Data folder ${dir} has mode ${mode.toString(8)}; it must be 0700 (chmod 700 "${dir}")`);
  }
  return dir;
}
