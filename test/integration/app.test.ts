// npm run test:integration — builds the app once in a temporary copy, then tests it through `next start`.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrateDatabase } from '../../src/server/db/migrate.ts';
import { buildCopy, REPO, startApp, tempDir } from './harness.ts';

let buildDir: string;
const cleanups: (() => void | Promise<void>)[] = [];

before(() => {
  buildDir = buildCopy();
  cleanups.push(() => fs.rmSync(buildDir, { recursive: true, force: true }));
});
after(async () => {
  for (const c of cleanups.reverse()) await c();
});

/** A fresh data folder (0700) with an optional database migrated to the first `upTo` committed migrations. */
async function dataFolder(upTo?: number) {
  const dir = tempDir('cb-it-data-');
  fs.chmodSync(dir, 0o700);
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (upTo !== undefined) {
    const all = readMigrationFiles({ migrationsFolder: path.join(REPO, 'drizzle') }).length;
    let migrationsFolder: string | undefined;
    if (upTo < all) {
      migrationsFolder = path.join(dir, 'm');
      fs.mkdirSync(path.join(migrationsFolder, 'meta'), { recursive: true });
      const journal = JSON.parse(fs.readFileSync(path.join(REPO, 'drizzle/meta/_journal.json'), 'utf8'));
      journal.entries = journal.entries.slice(0, upTo);
      for (const e of journal.entries) fs.copyFileSync(path.join(REPO, 'drizzle', `${e.tag}.sql`), path.join(migrationsFolder, `${e.tag}.sql`));
      fs.writeFileSync(path.join(migrationsFolder, 'meta/_journal.json'), JSON.stringify(journal));
    }
    await migrateDatabase({ dbPath: path.join(dir, 'branch.db'), backupDir: path.join(dir, 'backups'), migrationsFolder });
  }
  return dir;
}

async function app(dataDir: string) {
  const running = await startApp(buildDir, dataDir);
  cleanups.push(running.stop);
  return running;
}

const probe = async (url: string) => (await fetch(`${url}/api/it-probe`)).json() as Promise<Record<string, unknown>>;

test('server bundle: openVerifiedDatabase finds drizzle/ and accepts a current database', async () => {
  const dataDir = await dataFolder(Infinity);
  const { url } = await app(dataDir);
  const r = await probe(url);
  assert.equal(r.projectRoot, buildDir, 'PROJECT_ROOT is the app folder, not a bundle chunk folder');
  assert.equal(r.migrationsFolder, path.join(buildDir, 'drizzle'));
  assert.equal(r.ok, true, String(r.message));
  assert.equal(r.migrations, readMigrationFiles({ migrationsFolder: path.join(REPO, 'drizzle') }).length);
});

test('server bundle: a missing, stale or refused database is not used, and is left unchanged', async () => {
  const dataDir = await dataFolder();
  const { url } = await app(dataDir);
  const dbPath = path.join(dataDir, 'branch.db');

  let r = await probe(url);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'database_missing');
  assert.equal(fs.existsSync(dbPath), false, 'no empty database created by the app');

  // One migration behind the code, as after an update started without db:migrate.
  const stale = await dataFolder(1);
  fs.copyFileSync(path.join(stale, 'branch.db'), dbPath);
  const before = fs.readFileSync(dbPath);
  r = await probe(url);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'self_test_failed');
  assert.match(String(r.message), /1 of \d+ migrations applied/);
  assert.deepEqual(fs.readFileSync(dbPath), before, 'the stale database was not migrated or changed');
});

// ---- Phase 2: login and sessions, through the real server -------------------------------------------------------


const PUBLIC_API = new Set(['/api/branch-address', '/api/auth/login', '/api/auth/setup']);
const PASSWORD = 'correct horse battery';

/** Every API route in the app, with the HTTP methods its route.ts exports. New routes are covered automatically. */
function apiRoutes(): { path: string; methods: string[] }[] {
  const root = path.join(REPO, 'src/app');
  const found: { path: string; methods: string[] }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'route.ts' && p.includes(`${path.sep}api${path.sep}`)) {
        const src = fs.readFileSync(p, 'utf8');
        const methods = [...src.matchAll(/export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
        found.push({ path: `/${path.relative(root, path.dirname(p)).split(path.sep).join('/')}`, methods });
      }
    }
  };
  walk(path.join(root, 'api'));
  return found;
}

/** The console pages (src/app/(console)/<name>/page.tsx). */
const consolePages = () =>
  fs.readdirSync(path.join(REPO, 'src/app/(console)'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('[') && fs.existsSync(path.join(REPO, 'src/app/(console)', e.name, 'page.tsx')))
    .map((e) => `/${e.name}`);

let site: { url: string; host: string; dataDir: string };
const send = (p: string, init: RequestInit & { cookie?: string; origin?: string | null } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  const origin = init.origin === undefined ? site.url : init.origin;
  if (origin) headers.set('origin', origin);
  return fetch(`${site.url}${p}`, { ...init, headers, redirect: 'manual' });
};
const postJson = (p: string, body: unknown, init: { cookie?: string; origin?: string | null } = {}) =>
  send(p, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, ...init });
const cookieOf = (res: Response) => res.headers.get('set-cookie') ?? '';
const tokenOf = (res: Response) => /__Host-cb_session=([^;]*)/.exec(cookieOf(res))?.[1] ?? '';
const FORGED = `__Host-cb_session=${'A'.repeat(43)}`;
const siteDb = () => new Database(path.join(site.dataDir, 'branch.db'));

test('login: the site starts with no account and shows the first-run screen with a 0600 code file', async () => {
  const dataDir = await dataFolder(Infinity);
  const running = await app(dataDir);
  site = { url: running.url, host: running.host, dataDir };
  const res = await send('/login');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Create the first account/);
  const codeFile = path.join(dataDir, 'first-run-code.txt');
  assert.equal(fs.statSync(codeFile).mode & 0o777, 0o600);
});

test('login: every protected API route refuses signed-out and forged sessions, even past the proxy', async () => {
  const routes = apiRoutes();
  assert.ok(routes.some((r) => r.path === '/api/branch-status'), 'route discovery works');
  const protectedRoutes = routes.filter((r) => !PUBLIC_API.has(r.path));
  assert.ok(protectedRoutes.length >= 3);
  for (const r of protectedRoutes) {
    assert.ok(r.methods.length > 0, `${r.path} exports no handler the test can see`);
    for (const method of r.methods) {
      for (const cookie of [undefined, FORGED, '__Host-cb_session=', 'cb_session=x']) {
        const res = await send(r.path, { method, cookie });
        assert.equal(res.status, 401, `${method} ${r.path} with ${cookie ?? 'no cookie'}`);
        assert.equal(res.headers.get('cache-control'), 'no-store');
      }
    }
  }
});

test('login: pages redirect to sign-in without a session; a forged cookie passes the proxy but not the page check', async () => {
  for (const page of [...consolePages(), '/']) {
    const bare = await send(page);
    assert.equal(bare.status, 307, page);
    assert.equal(new URL(bare.headers.get('location')!, site.url).pathname, '/login', page);
    const forged = await send(page, { cookie: FORGED });
    assert.ok([303, 307].includes(forged.status), `${page} with a forged cookie: ${forged.status}`);
    assert.equal(new URL(forged.headers.get('location')!, site.url).pathname, page === '/' ? '/dashboard' : '/login', page);
  }
  const deep = await send('/parcels?q=CB1');
  assert.equal(new URL(deep.headers.get('location')!, site.url).searchParams.get('next'), '/parcels?q=CB1');
  // Open without a session: the phone Setup page, the login page, the CA certificate route and the branch address.
  for (const open of ['/setup', '/login', '/api/branch-address']) assert.equal((await send(open)).status, 200, open);
  assert.notEqual((await send('/branch-ca.crt')).status, 307);
});

test('login: first account needs the right one-time code and a same-site request; then the code is gone', async () => {
  const codeFile = path.join(site.dataDir, 'first-run-code.txt');
  const code = fs.readFileSync(codeFile, 'utf8').trim();
  const account = { code, username: 'first.staff', password: PASSWORD };
  assert.equal((await postJson('/api/auth/setup', { ...account, code: 'AAAA-BBBB-CCCC-DDDD' })).status, 403);
  assert.equal((await postJson('/api/auth/setup', account, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await postJson('/api/auth/setup', account, { origin: null })).status, 403);
  assert.equal((await postJson('/api/auth/setup', { ...account, password: 'short' })).status, 400);
  const ok = await postJson('/api/auth/setup', account);
  assert.equal(ok.status, 200);
  assert.ok(tokenOf(ok));
  assert.equal(fs.existsSync(codeFile), false);
  assert.equal((await postJson('/api/auth/setup', { ...account, username: 'second.staff' })).status, 409);
  assert.equal((await send('/login', { cookie: `__Host-cb_session=${tokenOf(ok)}` })).status, 307, 'signed in: /login sends you on');
  const fresh = await send('/login');
  assert.doesNotMatch(await fresh.text(), /Create the first account/);
  assert.equal(fs.existsSync(codeFile), false, 'no new code once an account exists');
});

test('login: wrong password refused with no cookie; right password sets a secure session cookie', async () => {
  const wrong = await postJson('/api/auth/login', { username: 'first.staff', password: 'wrong password!!' });
  assert.equal(wrong.status, 401);
  assert.equal(cookieOf(wrong), '');
  assert.equal((await postJson('/api/auth/login', { username: 'nobody', password: PASSWORD })).status, 401);
  assert.equal((await postJson('/api/auth/login', 'not an object')).status, 400);
  assert.equal((await send('/api/auth/login', { method: 'POST', body: 'x'.repeat(10_000), headers: { 'content-type': 'application/json' } })).status, 400);
  assert.equal((await postJson('/api/auth/login', { username: 'first.staff', password: PASSWORD }, { origin: 'https://evil.example' })).status, 403);

  const ok = await postJson('/api/auth/login', { username: 'First.Staff', password: PASSWORD });
  assert.equal(ok.status, 200);
  const setCookie = cookieOf(ok);
  const attrs = setCookie.split(';').map((a) => a.trim());
  assert.match(attrs[0], /^__Host-cb_session=[A-Za-z0-9_-]{43}$/);
  for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) assert.ok(attrs.some((x) => x.toLowerCase() === a.toLowerCase()), `${a} in ${setCookie}`);
  assert.equal(/domain=/i.test(setCookie), false);
  assert.equal(ok.headers.get('cache-control'), 'no-store');

  const cookie = `__Host-cb_session=${tokenOf(ok)}`;
  const me = await send('/api/auth/session', { cookie });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { username: 'first.staff' });
  assert.equal((await send('/api/branch-status', { cookie })).status, 200);
  const page = await send('/dashboard', { cookie });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /first\.staff/);
});

test('login: logout ends the session on the server and clears the cookie', async () => {
  const ok = await postJson('/api/auth/login', { username: 'first.staff', password: PASSWORD });
  const cookie = `__Host-cb_session=${tokenOf(ok)}`;
  assert.equal((await postJson('/api/auth/logout', {}, { cookie, origin: 'https://evil.example' })).status, 403, 'cross-site logout refused');
  assert.equal((await send('/api/auth/session', { cookie })).status, 200);
  const out = await postJson('/api/auth/logout', {}, { cookie });
  assert.equal(out.status, 200);
  assert.match(cookieOf(out), /^__Host-cb_session=; Max-Age=0;/);
  assert.equal((await send('/api/auth/session', { cookie })).status, 401, 'the old token no longer works');
  assert.equal((await send('/dashboard', { cookie })).status, 307);
  assert.equal((await postJson('/api/auth/logout', {}, { cookie })).status, 401);
});

test('login: sessions persist through 6 idle days, end after 7 idle days or 30 days from sign-in; use never extends the deadline', async () => {
  const signIn = async () => `__Host-cb_session=${tokenOf(await postJson('/api/auth/login', { username: 'first.staff', password: PASSWORD }))}`;
  const DAY = 24 * 3600_000;
  const persisting = await signIn();
  const idle = await signIn();
  const absolute = await signIn();
  const db = siteDb();
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const hash = (c: string) => crypto.createHash('sha256').update(c.split('=')[1]).digest('hex');
  const deadlineOf = (c: string) => (db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hash(c)) as { expires_at: string }).expires_at;
  const signedInAt = Date.parse((db.prepare('SELECT created_at FROM sessions WHERE token_hash = ?').get(hash(persisting)) as { created_at: string }).created_at);
  assert.equal(Date.parse(deadlineOf(persisting)) - signedInAt, 30 * DAY, 'deadline is 30 days after sign-in');
  const deadlineBefore = deadlineOf(persisting);
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(ago(6 * DAY), hash(persisting));
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(ago(7 * DAY + 60_000), hash(idle));
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(ago(60_000), hash(absolute));
  assert.equal((await send('/api/auth/session', { cookie: persisting })).status, 200, 'six days unused: still signed in');
  assert.equal((await send('/dashboard', { cookie: persisting })).status, 200);
  assert.equal(deadlineOf(persisting), deadlineBefore, 'using the session did not move its 30-day deadline');
  db.close();
  assert.equal((await send('/api/auth/session', { cookie: idle })).status, 401);
  assert.equal((await send('/api/auth/session', { cookie: absolute })).status, 401, 'past the 30-day deadline even though used a minute ago');
  assert.equal((await send('/dashboard', { cookie: idle })).status, 307);

  const live = await signIn();
  const db2 = siteDb();
  db2.prepare("UPDATE users SET disabled = 1 WHERE username = 'first.staff'").run();
  db2.close();
  assert.equal((await send('/api/auth/session', { cookie: live })).status, 401);
  const db3 = siteDb();
  db3.prepare("UPDATE users SET disabled = 0 WHERE username = 'first.staff'").run();
  db3.close();
});

test('login: five wrong passwords pause sign-in for that username, with Retry-After', async () => {
  for (let i = 1; i < 5; i++) assert.equal((await postJson('/api/auth/login', { username: 'first.staff', password: `wrong-${i}-password` })).status, 401);
  const fifth = await postJson('/api/auth/login', { username: 'first.staff', password: 'wrong-5-password' });
  assert.equal(fifth.status, 429);
  assert.equal(fifth.headers.get('retry-after'), '60');
  const right = await postJson('/api/auth/login', { username: 'first.staff', password: PASSWORD });
  assert.equal(right.status, 429, 'paused even with the right password');
  assert.equal(cookieOf(right), '');
});

test('login: the audit log records logins without usernames, passwords, tokens or codes', async () => {
  const db = siteDb();
  const rows = db.prepare('SELECT action, outcome, entity_ids, detail FROM audit_log ORDER BY id').all() as { action: string; outcome: string; entity_ids: string; detail: string }[];
  const sessions = db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
  db.close();
  const actions = new Set(rows.map((r) => r.action));
  for (const a of ['user.first_run_refused', 'user.created', 'login.succeeded', 'login.failed', 'login.paused', 'session.ended']) assert.ok(actions.has(a), a);
  const text = JSON.stringify(rows);
  for (const secret of [PASSWORD, 'wrong-1-password', 'first.staff', 'nobody', 'AAAA-BBBB']) assert.equal(text.includes(secret), false, secret);
  assert.ok(sessions.every((s) => /^[0-9a-f]{64}$/.test(s.token_hash)), 'only token hashes stored');
});
