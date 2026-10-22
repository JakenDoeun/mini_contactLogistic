// npm run test:integration — builds the app once in a temporary copy, then tests it through `next start`.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { createUser } from '../../src/server/auth/accounts.ts';
import { verifyPassword } from '../../src/server/auth/password.ts';
import { readActiveRecoveryCode, rotateRecoveryCode } from '../../src/server/auth/recovery.ts';
import { createSession } from '../../src/server/auth/sessions.ts';
import { openDatabase } from '../../src/server/db/connection.ts';
import { applyPending, migrateDatabase } from '../../src/server/db/migrate.ts';
import { GATEWAY_FILE, writeGatewayConfig } from '../../src/server/gateway/smsgate.ts';
import { buildCopy, freePort, REPO, startApp, tempDir } from './harness.ts';

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
      // applyPending, not migrateDatabase: the self-test would refuse a database without the later tables.
      const db = openDatabase(path.join(dir, 'branch.db'));
      applyPending(db, readMigrationFiles({ migrationsFolder }), null);
      db.close();
    } else {
      await migrateDatabase({ dbPath: path.join(dir, 'branch.db'), backupDir: path.join(dir, 'backups') });
    }
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
  const stale = await dataFolder(readMigrationFiles({ migrationsFolder: path.join(REPO, 'drizzle') }).length - 1);
  fs.copyFileSync(path.join(stale, 'branch.db'), dbPath);
  const before = fs.readFileSync(dbPath);
  r = await probe(url);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'self_test_failed');
  assert.match(String(r.message), /missing tables: |\d+ of \d+ migrations applied/, 'refused because it is behind the code');
  assert.deepEqual(fs.readFileSync(dbPath), before, 'the stale database was not migrated or changed');
});

// ---- Phase 2: login and sessions, through the real server -------------------------------------------------------


const PUBLIC_API = new Set(['/api/branch-address', '/api/auth/login', '/api/auth/setup', '/api/auth/recover']);
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

let site: { url: string; host: string; dataDir: string; log: () => string };
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
  site = { url: running.url, host: running.host, dataDir, log: running.log };
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
  // Open without a session: the phone Setup page, the login page and the branch address.
  for (const open of ['/setup', '/login', '/api/branch-address']) assert.equal((await send(open)).status, 200, open);
  // The retired Caddy certificate download is an ordinary unknown page now: signed out, it goes to sign-in.
  const retired = await send('/branch-ca.crt');
  assert.equal(retired.status, 307, 'no certificate is served');
  assert.equal(new URL(retired.headers.get('location')!, site.url).pathname, '/login');
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

test('recovery: the recovery code resets a password once through the route, ends every session, and never leaves the server', async () => {
  const db = openDatabase(path.join(site.dataDir, 'branch.db'));
  rotateRecoveryCode(db, site.dataDir);
  const shown = readActiveRecoveryCode(db, site.dataDir);
  assert.ok(shown.ok);
  const { code } = shown;
  const { id } = db.prepare("SELECT id FROM users WHERE username = 'first.staff'").get() as { id: number };
  const cookie = `__Host-cb_session=${createSession(db, id)}`;
  db.close();
  assert.equal((await send('/api/auth/session', { cookie })).status, 200);

  const NEW = 'recovered passphrase here';
  const reset = { username: 'first.staff', code, password: NEW };
  assert.equal((await postJson('/api/auth/recover', reset, { origin: 'https://evil.example' })).status, 403, 'cross-site refused');
  const wrong = await postJson('/api/auth/recover', { ...reset, code: code.replace(/^./, (c) => (c === '0' ? '1' : '0')) });
  assert.equal(wrong.status, 403);
  assert.deepEqual(await wrong.json(), { error: 'bad_recovery' });
  assert.equal((await postJson('/api/auth/recover', { ...reset, password: 'short' })).status, 400);
  assert.equal((await send('/api/auth/session', { cookie })).status, 200, 'failed attempts change nothing');

  const ok = await postJson('/api/auth/recover', { ...reset, code: code.toLowerCase() });
  assert.equal(ok.status, 200);
  const body = await ok.text();
  assert.equal(body, '{"ok":true}');
  assert.match(cookieOf(ok), /^__Host-cb_session=; Max-Age=0;/);
  assert.equal((await send('/api/auth/session', { cookie })).status, 401, 'every session ended');
  assert.equal((await postJson('/api/auth/recover', { ...reset, password: 'another passphrase!' })).status, 403, 'used once only');
  assert.equal(fs.existsSync(path.join(site.dataDir, 'recovery-code.txt')), false);

  const check = siteDb();
  const { password_hash } = check.prepare("SELECT password_hash FROM users WHERE username = 'first.staff'").get() as { password_hash: string };
  const audit = JSON.stringify(check.prepare('SELECT * FROM audit_log').all());
  check.close();
  assert.equal(await verifyPassword(NEW, password_hash), true);
  const bare = code.replace(/-/g, '');
  for (const where of [audit, site.log()]) {
    assert.equal(where.includes(bare) || where.includes(code), false, 'code never in the audit log or server output');
  }
});

test('backups and data: any staff member saves a backup; only the admin changes how long data is kept (Phase 3)', async () => {
  const db = openDatabase(path.join(site.dataDir, 'branch.db'));
  const { id: adminId } = db.prepare("SELECT id FROM users WHERE username = 'first.staff'").get() as { id: number };
  const staff = await createUser(db, 'second.staff', 'correct horse battery', 'cli');
  assert.ok(staff.ok);
  const adminCookie = `__Host-cb_session=${createSession(db, adminId)}`;
  const staffCookie = `__Host-cb_session=${createSession(db, staff.userId)}`;
  db.close();
  const putDays = (days: unknown, cookie: string, origin?: string) =>
    send('/api/settings/retention', { method: 'PUT', body: JSON.stringify({ days }), headers: { 'content-type': 'application/json' }, cookie, origin });

  const before = await (await send('/api/backup', { cookie: staffCookie })).json();
  assert.deepEqual({ isAdmin: before.isAdmin, retentionDays: before.retentionDays }, { isAdmin: false, retentionDays: 7 });
  assert.equal((await postJson('/api/backup', {}, { cookie: staffCookie, origin: 'https://evil.example' })).status, 403);
  const saved = await postJson('/api/backup', {}, { cookie: staffCookie });
  assert.equal(saved.status, 200);
  const { lastBackupAt, failing } = await saved.json();
  assert.equal(failing, false);
  assert.ok(Date.now() - Date.parse(lastBackupAt) < 60_000, 'a backup was just saved');
  assert.ok(fs.readdirSync(path.join(site.dataDir, 'backups')).some((f) => f.startsWith('backup-')));

  assert.equal((await putDays(3, staffCookie)).status, 403, 'staff cannot change it');
  assert.equal((await putDays(3, adminCookie, 'https://evil.example')).status, 403);
  assert.equal((await putDays(15, adminCookie)).status, 400);
  const changed = await putDays(3, adminCookie);
  assert.equal(changed.status, 200);
  assert.deepEqual(await changed.json(), { retentionDays: 3 });
  const after = await (await send('/api/backup', { cookie: adminCookie })).json();
  assert.deepEqual({ isAdmin: after.isAdmin, retentionDays: after.retentionDays }, { isAdmin: true, retentionDays: 3 });
  assert.equal((await putDays(7, adminCookie)).status, 200);
});

test('sms: with no gateway phone set up, Notify is refused and the pages are told why (Phase 10)', async () => {
  const db = openDatabase(path.join(site.dataDir, 'branch.db'));
  const { id: adminId } = db.prepare("SELECT id FROM users WHERE username = 'first.staff'").get() as { id: number };
  const staff = await createUser(db, 'gateway.staff', 'correct horse battery', 'cli');
  assert.ok(staff.ok);
  const cookie = `__Host-cb_session=${createSession(db, adminId)}`;
  const staffCookie = `__Host-cb_session=${createSession(db, staff.userId)}`;
  db.close();
  const notify = () => postJson('/api/sms/batch', { requestKey: crypto.randomUUID(), day: '2026-01-01', items: [] }, { cookie });
  const gateway = async () => (await (await send('/api/parcels', { cookie })).json()).gateway;

  fs.rmSync(path.join(site.dataDir, GATEWAY_FILE), { force: true });
  assert.deepEqual(await gateway(), { setUp: false, awaySince: null });
  const refused = await notify();
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'no_gateway');

  writeGatewayConfig(site.dataDir, { url: 'http://127.0.0.1:9', username: 'sms', password: 'secret' });
  try {
    assert.equal((await gateway()).setUp, true);
    assert.notEqual((await (await notify()).json()).error, 'no_gateway'); // past the gateway check; refused for its own reasons
    // Row 26: the gateway's address goes to the admin only.
    assert.equal((await (await send('/api/gateway', { cookie })).json()).url, 'http://127.0.0.1:9');
    const forStaff = await (await send('/api/gateway', { cookie: staffCookie })).json();
    assert.equal(forStaff.configured, true);
    assert.equal('url' in forStaff, false);
  } finally {
    fs.rmSync(path.join(site.dataDir, GATEWAY_FILE), { force: true });
  }
});

test('imports: upload, review, staff decisions and Confirm through the real API (Phase 4)', async () => {
  const db = openDatabase(path.join(site.dataDir, 'branch.db'));
  const { id: staffId } = db.prepare("SELECT id FROM users WHERE username = 'first.staff'").get() as { id: number };
  const cookie = `__Host-cb_session=${createSession(db, staffId)}`;
  db.close();
  const fixture = (name: string) => new Blob([fs.readFileSync(path.join(REPO, 'test/fixtures', name))]);
  const upload = (name: string, as: string, init: { cookie?: string; origin?: string | null } = { cookie }) => {
    const form = new FormData();
    form.append('file', fixture(name), as);
    return send('/api/imports/check', { method: 'POST', body: form, ...init });
  };
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

  assert.equal((await upload('scan-record-mixed.csv', 'a.csv', {})).status, 401, 'signed out');
  assert.equal((await upload('scan-record-mixed.csv', 'a.csv', { cookie, origin: 'https://evil.example' })).status, 403);
  const checked = await upload('scan-record-mixed-xlsx-named.xls', 'C:\\fakepath\\Scan_record.xls');
  assert.equal(checked.status, 201);
  const { importId, status } = await checked.json();
  assert.equal(status, 'checked');

  const review = await (await send(`/api/imports/${importId}?choice=single_scan_date`, { cookie })).json();
  assert.deepEqual(review.counts, { unique: 10, db_duplicate: 0, left_out: 0, blocked: 3, ready: 7 });
  assert.equal(review.fileName, 'Scan_record.xls');
  assert.equal(review.canConfirm, false);
  const blocking = review.items.filter((i: { blocking: boolean }) => i.blocking) as { id: number }[];
  assert.equal(blocking.length, 3);
  const decide = (id: number, body: unknown) => send(`/api/imports/review-items/${id}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, cookie });
  assert.equal((await decide(blocking[0].id, { resolution: 'chosen', chosen: { name: 'Not In File', phone: '012345678' } })).status, 400);
  for (const i of blocking) assert.equal((await decide(i.id, { resolution: 'left_out' })).status, 200);

  const body = { arrivalBatchDate: today, dateChoice: 'single_scan_date', batchDateChosen: true };
  assert.equal((await postJson(`/api/imports/${importId}/confirm`, body, { cookie, origin: 'https://evil.example' })).status, 403);
  const confirmed = await postJson(`/api/imports/${importId}/confirm`, body, { cookie });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(await confirmed.json(), { ok: true, added: 7 });
  assert.equal((await postJson(`/api/imports/${importId}/confirm`, body, { cookie })).status, 409, 'a second Confirm adds nothing');
  const history = (await (await send('/api/imports', { cookie })).json()).imports as { id: number; status: string; added: number }[];
  assert.deepEqual([history[0].id, history[0].status, history[0].added], [importId, 'imported', 7]);
  const check = siteDb();
  assert.equal(check.prepare('SELECT count(*) FROM parcels WHERE first_import_id = ? AND arrival_date = ?').pluck().get(importId, today), 7);
  check.close();

  const bad = await upload('headers-no-send-outlet.xlsx', 'b.xlsx');
  assert.equal(bad.status, 422);
  assert.deepEqual(Object.keys(await bad.json()).sort(), ['errorCode', 'importId', 'message', 'status']);
});

test('serve: migrates, starts the app, restarts it after a crash, and saves a backup when stopped (Phase 3)', async () => {
  const dataDir = await dataFolder();
  const port = await freePort();
  let out = '';
  const serve = spawn(process.execPath, ['scripts/serve.ts', `--data-dir=${dataDir}`, `--port=${port}`], {
    cwd: buildDir,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', BRANCH_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serve.stdout!.on('data', (d) => (out += d));
  serve.stderr!.on('data', (d) => (out += d));
  cleanups.push(() => void (serve.exitCode === null && serve.kill('SIGKILL')));
  const up = async (wantUp: boolean) => {
    for (let i = 0; i < 300; i++) {
      const ok = await fetch(`http://127.0.0.1:${port}/login`, { redirect: 'manual' }).then(() => true, () => false);
      if (ok === wantUp) return;
      if (serve.exitCode !== null) throw new Error(`serve exited:\n${out}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`the app did not come ${wantUp ? 'up' : 'down'}:\n${out}`);
  };
  await up(true);
  assert.equal(fs.readFileSync(path.join(dataDir, 'serve.pid'), 'utf8'), String(serve.pid));
  assert.match(out, /Backup saved \(start\)/);

  const [web] = execFileSync('pgrep', ['-P', String(serve.pid)], { encoding: 'utf8' }).trim().split('\n').map(Number);
  process.kill(web, 'SIGKILL');
  await up(false);
  await up(true);
  assert.match(out, /Web app stopped \(SIGKILL\); restarting in 5 s/);

  const db = openDatabase(path.join(dataDir, 'branch.db'));
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('it.marker', '1', ?)").run(new Date().toISOString());
  db.close();
  const exited = new Promise<number | null>((resolve) => serve.once('exit', resolve));
  serve.kill('SIGTERM');
  assert.equal(await exited, 0, out);
  assert.match(out, /Backup saved \(stop\)/, 'the change made before stopping is in a backup');
  assert.equal(fs.existsSync(path.join(dataDir, 'serve.pid')), false);
  assert.equal(fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.startsWith('backup-')).length, 2);
});

test('serve: --log collects its own and the web app output; killing serve outright also ends the web app (Windows task stop)', async () => {
  const dataDir = await dataFolder();
  const port = await freePort();
  const logFile = path.join(dataDir, 'logs', 'serve.log');
  const serve = spawn(process.execPath, ['scripts/serve.ts', `--data-dir=${dataDir}`, `--port=${port}`, `--log=${logFile}`], {
    cwd: buildDir,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', BRANCH_URL: '' },
    stdio: 'ignore',
  });
  cleanups.push(() => void (serve.exitCode === null && serve.kill('SIGKILL')));
  const answers = () => fetch(`http://127.0.0.1:${port}/login`, { redirect: 'manual' }).then(() => true, () => false);
  for (let i = 0; i < 300 && !(await answers()); i++) await new Promise((r) => setTimeout(r, 100));
  const [web] = execFileSync('pgrep', ['-P', String(serve.pid)], { encoding: 'utf8' }).trim().split('\n').map(Number);
  cleanups.push(() => {
    try {
      process.kill(web, 'SIGKILL');
    } catch {
      // already gone, as it should be
    }
  });

  const log = fs.readFileSync(logFile, 'utf8');
  assert.match(log, /\[serve .*\] Backup saved \(start\)/);
  assert.match(log, /Ready in/, 'the web app output is in the log too');

  serve.kill('SIGKILL');
  const gone = async () => {
    try {
      process.kill(web, 0);
      return false;
    } catch {
      return true;
    }
  };
  for (let i = 0; i < 100 && !(await gone()); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(await gone(), true, 'the web app exits within 10 s of its launcher');
  assert.equal(await answers(), false, 'the port is free again');
});

test('serve: with automatic checks on, files saved while stopped and while running are found, never imported (Phase 5 gate)', async () => {
  const dataDir = await dataFolder(Infinity);
  const watched = path.join(dataDir, 'watched');
  fs.mkdirSync(watched);
  const db = openDatabase(path.join(dataDir, 'branch.db'));
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('folder.settings', ?, ?)").run(
    JSON.stringify({ path: watched, auto: true, intervalSeconds: 30 }),
    new Date().toISOString(),
  );
  fs.copyFileSync(path.join(REPO, 'test/fixtures/scan-record-mixed.xlsx'), path.join(watched, 'while-stopped.xlsx'));
  const port = await freePort();
  let out = '';
  const serve = spawn(process.execPath, ['scripts/serve.ts', `--data-dir=${dataDir}`, `--port=${port}`], {
    cwd: buildDir,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', BRANCH_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serve.stdout!.on('data', (d) => (out += d));
  serve.stderr!.on('data', (d) => (out += d));
  cleanups.push(() => void (serve.exitCode === null && serve.kill('SIGKILL')));
  const found = async (name: string, seconds: number) => {
    for (let i = 0; i < seconds * 2; i++) {
      if (db.prepare("SELECT state FROM detected_files WHERE path = ?").pluck().get(path.join(watched, name)) === 'waiting') return;
      if (serve.exitCode !== null) throw new Error(`serve exited:\n${out}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`${name} was not found within ${seconds} s:\n${out}`);
  };
  await found('while-stopped.xlsx', 30);
  fs.copyFileSync(path.join(REPO, 'test/fixtures/scan-record-two-days.xlsx'), path.join(watched, 'while-running.xlsx'));
  await found('while-running.xlsx', 60);
  assert.match(out, /Folder check: 1 new file\(s\) waiting for review/);
  assert.equal(db.prepare('SELECT count(*) FROM imports').pluck().get(), 0, 'found files wait for staff; nothing is imported');
  db.close();
  const exited = new Promise((resolve) => serve.once('exit', resolve));
  serve.kill('SIGTERM');
  await exited;
});
