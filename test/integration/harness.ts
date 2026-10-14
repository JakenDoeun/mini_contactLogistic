// Integration harness: builds the app as Next.js really bundles it and runs `next start` against temporary data
// folders. The build happens in a temporary copy of the working tree (never in the project's .next, which the dev
// server uses), with test-only routes from ./fixtures added to that copy only.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Test-only routes copied into the build copy: fixture file -> path inside the copy. */
const FIXTURES: Record<string, string> = {
  'probe-route.ts': 'src/app/api/it-probe/route.ts',
};

export function tempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Copy the working tree (tracked files and new, not ignored ones), install from the lockfile and build. */
export function buildCopy(): string {
  const dir = tempDir('cb-it-build-');
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  for (const f of files) {
    const from = path.join(REPO, f);
    if (!fs.existsSync(from)) continue; // deleted in the working tree
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(from, path.join(dir, f));
  }
  for (const [fixture, target] of Object.entries(FIXTURES)) {
    fs.mkdirSync(path.dirname(path.join(dir, target)), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'test/integration/fixtures', fixture), path.join(dir, target));
  }
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
  execFileSync('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], { cwd: dir, env, stdio: 'pipe' });
  execFileSync(path.join(dir, 'node_modules/.bin/next'), ['build'], { cwd: dir, env, stdio: 'pipe' });
  return dir;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export interface RunningApp {
  url: string;
  host: string;
  log: () => string;
  stop: () => Promise<void>;
}

/** `next start` from the build copy with DATA_DIR set. It does not migrate: tests prepare the database themselves. */
export async function startApp(buildDir: string, dataDir: string): Promise<RunningApp> {
  const port = await freePort();
  let out = '';
  const child: ChildProcess = spawn(path.join(buildDir, 'node_modules/.bin/next'), ['start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: buildDir,
    env: { ...process.env, DATA_DIR: dataDir, NEXT_TELEMETRY_DISABLED: '1', BRANCH_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', (d) => (out += d));
  child.stderr!.on('data', (d) => (out += d));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      await fetch(`${url}/login`, { redirect: 'manual' });
      break;
    } catch {
      if (i > 100 || child.exitCode !== null) throw new Error(`next start did not come up:\n${out}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return {
    url,
    host: `127.0.0.1:${port}`,
    log: () => out,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
}
