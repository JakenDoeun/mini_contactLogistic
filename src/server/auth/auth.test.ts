import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/connection.ts';
import { createTestDb, makeTempDir, removeTempDir } from '../db/test-db.ts';
import { createFirstAccount, createUser, disableUser, ensureFirstRunCode, FIRST_RUN_FILE, logIn, logOut } from './accounts.ts';
import { clearedSessionCookie, readSessionToken, SESSION_COOKIE, sessionCookie } from './cookie.ts';
import { originAllowed } from './origin.ts';
import { hashPassword, normalizeUsername, validPassword, validUsername, verifyPassword } from './password.ts';
import { FAILURES_BEFORE_PAUSE, PAUSE_MS, resetAllPauses } from './pause.ts';
import { createSession, endSession, findSession, SESSION_IDLE_MS, SESSION_MAX_MS } from './sessions.ts';

afterEach(() => resetAllPauses());

const T0 = new Date('2026-10-14T01:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);
const PASSWORD = 'correct horse battery';

async function withUser(t: test.TestContext) {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  const created = await createUser(db, 'Staff.One', PASSWORD, 'cli', T0);
  assert.ok(created.ok);
  return { db, userId: created.userId };
}
const auditRows = (db: Db) =>
  db.prepare('SELECT action, user_id, entity_ids, outcome, detail FROM audit_log ORDER BY id').all() as {
    action: string; user_id: number | null; entity_ids: string; outcome: string; detail: string;
  }[];

test('passwords: scrypt hash verifies, wrong or malformed never does, each hash is salted', async () => {
  const a = await hashPassword(PASSWORD);
  const b = await hashPassword(PASSWORD);
  assert.match(a, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{88}$/);
  assert.notEqual(a, b, 'random salt');
  assert.equal(await verifyPassword(PASSWORD, a), true);
  assert.equal(await verifyPassword(PASSWORD.normalize('NFD'), a), true);
  assert.equal(await verifyPassword('correct horse battery ', a), false);
  assert.equal(await verifyPassword('', a), false);
  for (const bad of ['', 'plain', a.replace('scrypt', 'bcrypt'), a.replace('$32768$', '$1024$'), a.replace('$32768$', '$2097152$'), a.split('$').slice(0, 5).join('$')]) {
    assert.equal(await verifyPassword(PASSWORD, bad), false, bad);
  }
  assert.equal(validPassword('short'), false);
  assert.equal(validPassword(' '.repeat(20)), false);
  assert.equal(validPassword('x'.repeat(257)), false);
  assert.equal(validPassword(PASSWORD), true);
  assert.equal(normalizeUsername('  Staff.One '), 'staff.one');
  for (const u of ['ab', '-abc', 'a b c', 'name@x', 'x'.repeat(33)]) assert.equal(validUsername(u), false, u);
});

test('login: the right password signs in and is audited with the user ID only', async (t) => {
  const { db, userId } = await withUser(t);
  const r = await logIn(db, ' STAFF.ONE ', PASSWORD, T0);
  assert.ok(r.ok);
  assert.equal(r.userId, userId);
  assert.deepEqual(findSession(db, r.token, T0), { userId, username: 'staff.one', isAdmin: true }, 'the first account is the admin');
  const last = auditRows(db).at(-1)!;
  assert.deepEqual({ ...last, detail: JSON.parse(last.detail) }, { action: 'login.succeeded', user_id: userId, entity_ids: `[${userId}]`, outcome: 'ok', detail: {} });
});

test('login: a wrong password or unknown user gets the same answer; nothing typed reaches the audit log', async (t) => {
  const { db, userId } = await withUser(t);
  assert.deepEqual(await logIn(db, 'staff.one', 'wrong password!!', T0), { ok: false, reason: 'invalid' });
  assert.deepEqual(await logIn(db, 'nobody', PASSWORD, T0), { ok: false, reason: 'invalid' });
  assert.deepEqual(await logIn(db, PASSWORD, PASSWORD, T0), { ok: false, reason: 'invalid' }, 'password typed into the username field');
  assert.deepEqual(await logIn(db, 'staff.one', { $ne: '' }, T0), { ok: false, reason: 'invalid' });
  assert.equal((db.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }).n, 0);
  const failed = auditRows(db).filter((r) => r.action === 'login.failed');
  assert.deepEqual(failed.map((r) => [r.entity_ids, r.outcome, r.detail]), [
    [`[${userId}]`, 'failed', '{"error_code":"invalid_credentials"}'],
    ['[]', 'failed', '{"error_code":"invalid_credentials"}'],
    ['[]', 'failed', '{"error_code":"invalid_credentials"}'],
    [`[${userId}]`, 'failed', '{"error_code":"invalid_credentials"}'],
  ]);
  const everything = JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
  for (const secret of [PASSWORD, 'wrong password', 'nobody', 'staff.one']) assert.equal(everything.includes(secret), false, secret);
});

test('login: five wrong passwords in a row pause that username for a minute, even for the right password', async (t) => {
  const { db } = await withUser(t);
  for (let i = 1; i < FAILURES_BEFORE_PAUSE; i++) assert.deepEqual(await logIn(db, 'staff.one', `wrong-${i}-password`, T0), { ok: false, reason: 'invalid' });
  assert.deepEqual(await logIn(db, 'staff.one', 'wrong-5-password', T0), { ok: false, reason: 'paused', retryAfter: 60 });
  assert.deepEqual(await logIn(db, 'staff.one', PASSWORD, later(30_000)), { ok: false, reason: 'paused', retryAfter: 30 });
  assert.equal(auditRows(db).at(-1)!.action, 'login.paused');
  // Another username is not paused; the pause ends after a minute and success clears the count.
  assert.deepEqual(await logIn(db, 'someone.else', PASSWORD, later(30_000)), { ok: false, reason: 'invalid' });
  assert.ok((await logIn(db, 'staff.one', PASSWORD, later(PAUSE_MS))).ok);
  for (let i = 1; i < FAILURES_BEFORE_PAUSE; i++) await logIn(db, 'staff.one', 'wrong password!!', later(PAUSE_MS + i));
  assert.ok((await logIn(db, 'staff.one', PASSWORD, later(PAUSE_MS + 10))).ok, 'four failures after a success do not pause');
  // Unknown usernames pause the same way.
  for (let i = 1; i < FAILURES_BEFORE_PAUSE; i++) await logIn(db, 'ghost', 'wrong password!!', T0);
  assert.deepEqual(await logIn(db, 'ghost', 'wrong password!!', T0), { ok: false, reason: 'paused', retryAfter: 60 });
});

test('session policy: 7 days idle, 30 days absolute from sign-in (decision 9)', () => {
  assert.equal(SESSION_IDLE_MS, 7 * 24 * 3600_000);
  assert.equal(SESSION_MAX_MS, 30 * 24 * 3600_000);
});

test('sessions: only a hash is stored; idle, absolute and disabled-account expiry; invalid tokens refused', async (t) => {
  const { db, userId } = await withUser(t);
  const token = createSession(db, userId, T0);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM sessions').all()).includes(token), false, 'the raw token is never stored');

  for (const bad of ['', 'x', token.slice(1), `${token}x`, token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), null, 42, undefined]) {
    assert.equal(findSession(db, bad, T0), null, String(bad));
  }
  // Used within the idle window: stays valid and slides.
  assert.ok(findSession(db, token, later(SESSION_IDLE_MS - 1000)));
  assert.ok(findSession(db, token, later(2 * SESSION_IDLE_MS - 2000)));
  // Idle too long: refused and deleted.
  const idle = createSession(db, userId, T0);
  assert.equal(findSession(db, idle, later(SESSION_IDLE_MS)), null);
  assert.equal(findSession(db, idle, T0), null, 'deleted, not just hidden');
  // Persists across days of regular use, but the absolute deadline never moves: it ends 30 days after sign-in.
  const busy = createSession(db, userId, T0);
  const deadline = () => (db.prepare('SELECT expires_at FROM sessions WHERE user_id = ? ORDER BY created_at').all(userId) as { expires_at: string }[]);
  const expiresAt = new Date(T0.getTime() + SESSION_MAX_MS).toISOString();
  for (let d = 1; d < 30; d++) {
    assert.ok(findSession(db, busy, later(d * 24 * 3600_000)), `day ${d}`);
    assert.ok(deadline().every((r) => r.expires_at === expiresAt), `day ${d}: use did not extend the deadline`);
  }
  assert.ok(findSession(db, busy, later(SESSION_MAX_MS - 1000)), 'still valid one second before the deadline');
  assert.equal(findSession(db, busy, later(SESSION_MAX_MS)), null, 'ends at 30 days even though it was used the day before');
  // Logout ends exactly that session.
  const a = createSession(db, userId, T0);
  const b = createSession(db, userId, T0);
  assert.equal(endSession(db, a), true);
  assert.equal(findSession(db, a, T0), null);
  assert.ok(findSession(db, b, T0));
  // Disabling the account ends every session.
  assert.equal(disableUser(db, 'staff.one', T0), true);
  assert.equal(findSession(db, b, T0), null);
  assert.equal((db.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }).n, 0);
  assert.deepEqual(await logIn(db, 'staff.one', PASSWORD, T0), { ok: false, reason: 'invalid' }, 'a disabled account cannot sign in');
});

test('logout: ends the session and audits it; a second logout or a bad token does nothing', async (t) => {
  const { db, userId } = await withUser(t);
  const r = await logIn(db, 'staff.one', PASSWORD, T0);
  assert.ok(r.ok);
  assert.equal(logOut(db, r.token, T0), true);
  assert.equal(findSession(db, r.token, T0), null);
  assert.equal(logOut(db, r.token, T0), false);
  assert.equal(logOut(db, 'forged', T0), false);
  assert.deepEqual(auditRows(db).filter((x) => x.action === 'session.ended').map((x) => x.entity_ids), [`[${userId}]`]);
});

test('session cookie: __Host- prefix, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain; parsing', () => {
  const c = sessionCookie('tok');
  assert.equal(SESSION_COOKIE, '__Host-cb_session');
  const attrs = c.split('; ').slice(1);
  assert.equal(c.split('; ')[0], '__Host-cb_session=tok');
  for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) assert.ok(attrs.includes(a), a); // 30 days
  assert.equal(/domain=/i.test(c), false);
  assert.match(clearedSessionCookie(), /^__Host-cb_session=; Max-Age=0; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  assert.equal(readSessionToken('a=1; __Host-cb_session=abc; b=2'), 'abc');
  assert.equal(readSessionToken('cb_session=abc; x__Host-cb_session=def'), null);
  assert.equal(readSessionToken(null), null);
  assert.equal(readSessionToken('__Host-cb_session='), null);
});

test('origin check: the branch address or the same loopback host only', () => {
  const branch = 'https://office-pc.example.ts.net';
  assert.equal(originAllowed(branch, 'office-pc.example.ts.net', branch), true);
  assert.equal(originAllowed('http://127.0.0.1:3000', '127.0.0.1:3000', branch), true);
  assert.equal(originAllowed('http://localhost:3000', 'localhost:3000', null), true);
  for (const [origin, host] of [
    [null, '127.0.0.1:3000'],
    ['null', '127.0.0.1:3000'],
    ['https://evil.example', 'office-pc.example.ts.net'],
    ['http://office-pc.example.ts.net', 'office-pc.example.ts.net'],
    ['https://office-pc.example.ts.net.evil.example', 'office-pc.example.ts.net'],
    ['http://127.0.0.1:3001', '127.0.0.1:3000'],
    ['http://127.0.0.1:3000', 'office-pc.example.ts.net'],
    ['http://127.0.0.1:3000/path', '127.0.0.1:3000'],
    ['not a url', '127.0.0.1:3000'],
  ] as const) {
    assert.equal(originAllowed(origin, host, branch), false, `${origin} via ${host}`);
  }
});

test('first run: one-time code file 0600, never overwritten; wrong code refused; right code creates and signs in once', async (t) => {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  const dataDir = makeTempDir();
  t.after(() => removeTempDir(dataDir));
  const file = ensureFirstRunCode(db, dataDir)!;
  assert.equal(file, path.join(dataDir, FIRST_RUN_FILE));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const code = fs.readFileSync(file, 'utf8').trim();
  assert.match(code, /^[A-HJKMNP-TV-Z2-9]{4}(-[A-HJKMNP-TV-Z2-9]{4}){3}$/);
  ensureFirstRunCode(db, dataDir);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), code, 'not replaced');

  assert.deepEqual(await createFirstAccount(db, dataDir, 'AAAA-BBBB-CCCC-DDDD', 'first.staff', PASSWORD, T0), { ok: false, reason: 'bad_code' });
  assert.deepEqual(await createFirstAccount(db, dataDir, '', 'first.staff', PASSWORD, T0), { ok: false, reason: 'bad_code' });
  assert.deepEqual(await createFirstAccount(db, dataDir, code, 'first.staff', 'short', T0), { ok: false, reason: 'invalid_password' });
  assert.equal(fs.existsSync(file), true, 'a refused attempt keeps the code');

  const ok = await createFirstAccount(db, dataDir, code.toLowerCase().replace(/-/g, ' '), 'First.Staff', PASSWORD, T0);
  assert.ok(ok.ok);
  assert.deepEqual(findSession(db, ok.token, T0), { userId: ok.userId, username: 'first.staff', isAdmin: true });
  assert.equal(fs.existsSync(file), false, 'the code is used up');
  assert.deepEqual(await createFirstAccount(db, dataDir, code, 'second.staff', PASSWORD, T0), { ok: false, reason: 'exists' });
  assert.equal(ensureFirstRunCode(db, dataDir), null);
  assert.equal(fs.existsSync(file), false, 'no new code once an account exists');
  const actions = auditRows(db).map((r) => r.action);
  assert.deepEqual(actions, ['user.first_run_refused', 'user.first_run_refused', 'user.created', 'login.succeeded']);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM audit_log').all()).includes(code), false, 'the code is never logged');
});

test('first run: five wrong codes pause the screen for a minute', async (t) => {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  const dataDir = makeTempDir();
  t.after(() => removeTempDir(dataDir));
  const code = fs.readFileSync(ensureFirstRunCode(db, dataDir)!, 'utf8').trim();
  for (let i = 1; i < FAILURES_BEFORE_PAUSE; i++) await createFirstAccount(db, dataDir, `WRONG-${i}`, 'first.staff', PASSWORD, T0);
  assert.deepEqual(await createFirstAccount(db, dataDir, 'WRONG-5', 'first.staff', PASSWORD, T0), { ok: false, reason: 'paused', retryAfter: 60 });
  assert.deepEqual(await createFirstAccount(db, dataDir, code, 'first.staff', PASSWORD, later(1000)), { ok: false, reason: 'paused', retryAfter: 59 });
  assert.ok((await createFirstAccount(db, dataDir, code, 'first.staff', PASSWORD, later(PAUSE_MS))).ok);
});

test('accounts: usernames unique case-insensitively; invalid input refused before hashing', async (t) => {
  const { db } = await withUser(t);
  assert.deepEqual(await createUser(db, 'STAFF.ONE', PASSWORD, 'cli', T0), { ok: false, reason: 'exists' });
  assert.deepEqual(await createUser(db, 'x', PASSWORD, 'cli', T0), { ok: false, reason: 'invalid_username' });
  assert.deepEqual(await createUser(db, 'staff.two', 'short', 'cli', T0), { ok: false, reason: 'invalid_password' });
  const stored = db.prepare('SELECT username, password_hash FROM users').all() as { username: string; password_hash: string }[];
  assert.deepEqual(stored.map((u) => u.username), ['staff.one']);
  assert.equal(stored[0].password_hash.includes(PASSWORD), false);
});
