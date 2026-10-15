import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/connection.ts';
import { PROJECT_ROOT } from '../db/paths.ts';
import { createTestDb } from '../db/test-db.ts';
import { createFirstAccount, createUser, disableUser, ensureFirstRunCode, FIRST_RUN_FILE, logIn } from './accounts.ts';
import { FAILURES_BEFORE_PAUSE, PAUSE_MS, resetAllPauses } from './pause.ts';
import {
  encodeCrockford, formatCode, newRecoveryCode, normalizeRecoveryCode, readActiveRecoveryCode, recoverPassword, RECOVERY_BYTES,
  RECOVERY_FILE, revokeRecoveryCode, rotateRecoveryCode,
} from './recovery.ts';
import { createSession, findSession } from './sessions.ts';

afterEach(() => resetAllPauses());

const T0 = new Date('2026-10-14T01:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);
const OLD = 'correct horse battery';
const NEW = 'a brand new passphrase';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Reference decoder, independent of the encoder: 5 bits per character back to bytes. */
const decode = (code: string) => {
  const bits = [...code].map((c) => CROCKFORD.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
};

async function setup(t: test.TestContext) {
  const { db, dir, cleanup } = await createTestDb();
  t.after(() => {
    fs.chmodSync(dir, 0o700);
    cleanup();
  });
  const created = await createUser(db, 'staff.one', OLD, 'cli', T0);
  assert.ok(created.ok);
  rotateRecoveryCode(db, dir, T0);
  const shown = readActiveRecoveryCode(db, dir);
  assert.ok(shown.ok);
  return { db, dir, userId: created.userId, code: shown.code };
}
const codeRows = (db: Db) =>
  db.prepare('SELECT id, code_hash, ended_at, end_reason, used_by FROM recovery_codes ORDER BY id').all() as {
    id: number; code_hash: string; ended_at: string | null; end_reason: string | null; used_by: number | null;
  }[];
const auditText = (db: Db) => JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
const actions = (db: Db) => (db.prepare('SELECT action FROM audit_log ORDER BY id').all() as { action: string }[]).map((r) => r.action);
const passwordWorks = async (db: Db, password: string, at: Date) => (await logIn(db, 'staff.one', password, at)).ok;

test('format: 32 Crockford Base32 characters from 20 random bytes, shown as eight groups of four', () => {
  assert.equal(encodeCrockford(Buffer.alloc(20)), '0'.repeat(32));
  assert.equal(encodeCrockford(Buffer.alloc(20, 0xff)), 'Z'.repeat(32));
  for (let i = 0; i < 200; i++) {
    const bytes = crypto.randomBytes(20);
    const code = encodeCrockford(bytes);
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{32}$/);
    assert.deepEqual(decode(code), bytes, 'every bit of the 160 is kept');
  }
  const formatted = formatCode('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
  assert.equal(formatted, '0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ');
  assert.match(formatted, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
});

test('format: typed codes are case-, space- and dash-insensitive with Crockford look-alikes; anything else is no code', () => {
  const code = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  for (const typed of [code, formatCode(code), formatCode(code).toLowerCase(), ` ${formatCode(code).replace(/-/g, ' ')} `]) {
    assert.equal(normalizeRecoveryCode(typed), code, typed);
  }
  assert.equal(normalizeRecoveryCode('O1I3L5' + code.slice(6)), '011315' + code.slice(6), 'O→0, I/L→1');
  for (const bad of ['', code.slice(1), code + '0', 'U' + code.slice(1), 'AAAA-BBBB-CCCC-DDDD', 'x'.repeat(200), 42, null, { code }]) {
    assert.equal(normalizeRecoveryCode(bad), '', String(bad));
  }
});

test('generation: asks the random source for 20 bytes; equal bytes give equal codes, different bytes different codes', () => {
  const asked: number[] = [];
  const fixed = (n: number) => (asked.push(n), Buffer.alloc(n, 7));
  assert.equal(newRecoveryCode(fixed), newRecoveryCode(fixed));
  assert.deepEqual(asked, [RECOVERY_BYTES, RECOVERY_BYTES]);
  assert.equal(RECOVERY_BYTES * 8, 160);
  const codes = new Set(Array.from({ length: 1000 }, () => newRecoveryCode()));
  assert.equal(codes.size, 1000);
});

test('file: rotate writes the code to a 0600 file in the data folder, leaves no temporary file, and stores only a hash', async (t) => {
  const { db, dir, code } = await setup(t);
  const file = path.join(dir, RECOVERY_FILE);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, 'utf8'), `${code}\n`);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes(RECOVERY_FILE)), [RECOVERY_FILE]);
  const [row] = codeRows(db);
  assert.equal(row.code_hash, crypto.createHash('sha256').update(code.replace(/-/g, '')).digest('hex'));
  const dbText = JSON.stringify(db.prepare('SELECT * FROM recovery_codes').all());
  assert.equal(dbText.includes(code.replace(/-/g, '')), false);
  assert.equal(auditText(db).includes(code.replace(/-/g, '').slice(0, 8)), false, 'no code in the audit log');
  assert.equal(auditText(db).includes(row.code_hash), false, 'no hash in the audit log');
});

test('expiry: no time limit; a code works years after it was made', async (t) => {
  const { db, dir, code } = await setup(t);
  const years = later(5 * 365 * 24 * 3600_000);
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', code, NEW, years), { ok: true, userId: 1 });
});

test('one-time use: success changes the password, ends every session, consumes the code and removes its file', async (t) => {
  const { db, dir, userId, code } = await setup(t);
  const laptop = createSession(db, userId, T0);
  const phone = createSession(db, userId, T0);
  assert.deepEqual(await recoverPassword(db, dir, ' STAFF.ONE ', code.toLowerCase(), NEW, later(1000)), { ok: true, userId });
  assert.equal(findSession(db, laptop, later(2000)), null);
  assert.equal(findSession(db, phone, later(2000)), null);
  assert.equal(await passwordWorks(db, OLD, later(3000)), false);
  assert.equal(await passwordWorks(db, NEW, later(3000)), true);
  assert.deepEqual(codeRows(db).map((r) => [r.end_reason, r.used_by]), [['used', userId]]);
  assert.equal(fs.existsSync(path.join(dir, RECOVERY_FILE)), false);
  assert.deepEqual(readActiveRecoveryCode(db, dir), { ok: false, reason: 'none' });
  // The same code again, even for the right account, is refused and changes nothing.
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', code, 'yet another passphrase', later(4000)), { ok: false, reason: 'invalid' });
  assert.equal(await passwordWorks(db, NEW, later(5000)), true);
  assert.ok(actions(db).includes('user.password_recovered'));
  assert.equal(auditText(db).includes(NEW), false);
});

test('invalid attempts: wrong code, unknown or disabled account, bad password leave the code active and the password unchanged', async (t) => {
  const { db, dir, code } = await setup(t);
  await createUser(db, 'staff.two', OLD, 'cli', T0);
  disableUser(db, 'staff.two', T0);
  const other = newRecoveryCode();
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', other, NEW, T0), { ok: false, reason: 'invalid' });
  assert.deepEqual(await recoverPassword(db, dir, 'nobody', code, NEW, T0), { ok: false, reason: 'invalid' });
  assert.deepEqual(await recoverPassword(db, dir, 'staff.two', code, NEW, T0), { ok: false, reason: 'invalid' }, 'a disabled account stays locked');
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', code, 'short', T0), { ok: false, reason: 'invalid_password' });
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', { $ne: '' }, NEW, T0), { ok: false, reason: 'invalid' });
  assert.equal(codeRows(db)[0].ended_at, null, 'not consumed');
  assert.ok(readActiveRecoveryCode(db, dir).ok);
  assert.equal(await passwordWorks(db, OLD, T0), true);
  const refused = (db.prepare("SELECT detail FROM audit_log WHERE action = 'user.recovery_refused'").all() as { detail: string }[]).map((r) => r.detail);
  assert.deepEqual(refused, Array(4).fill('{"error_code":"invalid_recovery"}'));
  for (const secret of [code.replace(/-/g, ''), other, 'nobody', NEW]) assert.equal(auditText(db).includes(secret), false, secret);
});

test('rate limit: five failed attempts pause recovery for a minute, even with the right code', async (t) => {
  const { db, dir, code } = await setup(t);
  for (let i = 1; i < FAILURES_BEFORE_PAUSE; i++) {
    assert.deepEqual(await recoverPassword(db, dir, 'staff.one', newRecoveryCode(), NEW, T0), { ok: false, reason: 'invalid' });
  }
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', newRecoveryCode(), NEW, T0), { ok: false, reason: 'paused', retryAfter: 60 });
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', code, NEW, later(PAUSE_MS - 1000)), { ok: false, reason: 'paused', retryAfter: 1 });
  assert.equal(codeRows(db)[0].ended_at, null);
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', code, NEW, later(PAUSE_MS)), { ok: true, userId: 1 });
});

test('rotation: the old code stops working at once, the new one works, and only one code is ever active', async (t) => {
  const { db, dir, code: first } = await setup(t);
  rotateRecoveryCode(db, dir, later(1000));
  const second = readActiveRecoveryCode(db, dir);
  assert.ok(second.ok);
  assert.notEqual(second.code, first);
  assert.deepEqual(codeRows(db).map((r) => r.end_reason), ['rotated', null]);
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', first, NEW, later(2000)), { ok: false, reason: 'invalid' });
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', second.code, NEW, later(3000)), { ok: true, userId: 1 });
  assert.throws(
    () => db.prepare('INSERT INTO recovery_codes (code_hash, created_at) VALUES (?, ?), (?, ?)').run('a'.repeat(64), T0.toISOString(), 'b'.repeat(64), T0.toISOString()),
    /UNIQUE constraint failed/,
  );
  assert.deepEqual(actions(db).filter((a) => a.startsWith('recovery_code.')), ['recovery_code.rotated', 'recovery_code.rotated']);
});

test('revoke: ends the code without a replacement and removes the file; nothing is created again by itself', async (t) => {
  const { db, dir, code } = await setup(t);
  assert.equal(revokeRecoveryCode(db, dir, later(1000)), true);
  assert.equal(revokeRecoveryCode(db, dir, later(2000)), false);
  assert.equal(fs.existsSync(path.join(dir, RECOVERY_FILE)), false);
  assert.deepEqual(readActiveRecoveryCode(db, dir), { ok: false, reason: 'none' });
  assert.equal(fs.existsSync(path.join(dir, RECOVERY_FILE)), false, 'show never creates a code');
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', code, NEW, later(3000)), { ok: false, reason: 'invalid' });
  assert.deepEqual(codeRows(db).map((r) => r.end_reason), ['revoked']);
});

test('failure: a used code stays invalid when its file cannot be removed', async (t) => {
  const { db, dir, code } = await setup(t);
  fs.chmodSync(dir, 0o500); // the file cannot be unlinked now
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', code, NEW, T0), { ok: true, userId: 1 });
  assert.ok(fs.existsSync(path.join(dir, RECOVERY_FILE)), 'cleanup failed, as intended');
  assert.deepEqual(readActiveRecoveryCode(db, dir), { ok: false, reason: 'none' }, 'the leftover file is never shown');
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', code, 'yet another passphrase', later(1000)), { ok: false, reason: 'invalid' });
  fs.chmodSync(dir, 0o700);
  readActiveRecoveryCode(db, dir);
  assert.equal(fs.existsSync(path.join(dir, RECOVERY_FILE)), false, 'removed at the next show once possible');
});

test('failure: a database error during rotate keeps the old code active and its file unchanged', async (t) => {
  const { db, dir, code } = await setup(t);
  db.exec("CREATE TEMP TRIGGER fail_insert BEFORE INSERT ON recovery_codes BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  assert.throws(() => rotateRecoveryCode(db, dir, later(1000)), /disk full/);
  db.exec('DROP TRIGGER fail_insert');
  assert.deepEqual(readActiveRecoveryCode(db, dir), { ok: true, code });
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes(RECOVERY_FILE)), [RECOVERY_FILE], 'temporary file removed');
  assert.deepEqual(codeRows(db).map((r) => r.end_reason), [null]);
});

const tempFiles = (dir: string) => fs.readdirSync(dir).filter((f) => f.startsWith(`${RECOVERY_FILE}.`));

/** After a rotate that stopped between commit and rename: no code works, nothing is shown, and a new rotate restores one. */
async function assertFailedClosedThenRestore(db: Db, dir: string, oldCode: string) {
  assert.deepEqual(codeRows(db).map((r) => r.end_reason), ['rotated', null], 'the database switched to a new code');
  assert.deepEqual(readActiveRecoveryCode(db, dir), { ok: false, reason: 'file_stale' }, 'show refuses: the file still holds the old code');
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', oldCode, NEW, later(1000)), { ok: false, reason: 'invalid' }, 'old code refused');
  assert.equal(await passwordWorks(db, OLD, later(1000)), true);

  rotateRecoveryCode(db, dir, later(2000));
  assert.deepEqual(tempFiles(dir), [], 'leftover temporary files removed');
  const restored = readActiveRecoveryCode(db, dir);
  assert.ok(restored.ok);
  assert.notEqual(restored.code, oldCode);
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', restored.code, NEW, later(3000)), { ok: true, userId: 1 });
}

test('failure: the rename fails after the database commit: fails closed, then rotate restores a usable code', async (t) => {
  const { db, dir, code } = await setup(t);
  const rename = t.mock.method(fs, 'renameSync', () => {
    throw Object.assign(new Error('EIO: i/o error, rename'), { code: 'EIO' });
  });
  assert.throws(() => rotateRecoveryCode(db, dir, later(500)), /could not be saved.*rotate again/);
  rename.mock.restore();
  assert.deepEqual(tempFiles(dir), [], 'the new code is not left in a temporary file');
  assert.equal(fs.readFileSync(path.join(dir, RECOVERY_FILE), 'utf8'), `${code}\n`, 'the old file is untouched');
  await assertFailedClosedThenRestore(db, dir, code);
});

test('failure: the process stops between the database commit and the rename: fails closed, then rotate restores', async (t) => {
  const { db, dir, code } = await setup(t);
  // A real stop: the child process kills itself where the rename would happen, after the commit.
  const child = `
    import fs from 'node:fs';
    import { openDatabase } from ${JSON.stringify(path.join(PROJECT_ROOT, 'src/server/db/connection.ts'))};
    import { rotateRecoveryCode } from ${JSON.stringify(path.join(PROJECT_ROOT, 'src/server/auth/recovery.ts'))};
    fs.renameSync = () => process.kill(process.pid, 'SIGKILL');
    rotateRecoveryCode(openDatabase(process.argv[1]), process.argv[2]);`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', child, path.join(dir, 'branch.db'), dir], { encoding: 'utf8' });
  assert.equal(run.signal, 'SIGKILL', run.stderr);
  const [left] = tempFiles(dir);
  assert.ok(left, 'the stopped run left its temporary file');
  assert.equal(fs.statSync(path.join(dir, left)).mode & 0o777, 0o600, 'still private');
  assert.equal(fs.readFileSync(path.join(dir, RECOVERY_FILE), 'utf8'), `${code}\n`);
  await assertFailedClosedThenRestore(db, dir, code);
});

test('failure: revoke also removes temporary files left by a stopped rotate', async (t) => {
  const { db, dir } = await setup(t);
  fs.writeFileSync(path.join(dir, `${RECOVERY_FILE}.0123456789ab.tmp`), 'x', { mode: 0o600 });
  assert.equal(revokeRecoveryCode(db, dir, later(1000)), true);
  assert.deepEqual(tempFiles(dir), []);
});

test('failure: a missing or stale file is reported, never replaced, and the database still decides', async (t) => {
  const { db, dir, code } = await setup(t);
  const file = path.join(dir, RECOVERY_FILE);
  fs.rmSync(file);
  assert.deepEqual(readActiveRecoveryCode(db, dir), { ok: false, reason: 'file_missing' });
  assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, `${formatCode(newRecoveryCode())}\n`, { mode: 0o600 });
  assert.deepEqual(readActiveRecoveryCode(db, dir), { ok: false, reason: 'file_stale' });
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', fs.readFileSync(file, 'utf8'), NEW, T0), { ok: false, reason: 'invalid' }, 'a planted file grants nothing');
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', code, NEW, later(1000)), { ok: true, userId: 1 });
});

test('failure: two requests with the same code at once: exactly one succeeds', async (t) => {
  const { db, dir, code } = await setup(t);
  const results = await Promise.all([
    recoverPassword(db, dir, 'staff.one', code, NEW, T0),
    recoverPassword(db, dir, 'staff.one', code, 'a different passphrase', T0),
  ]);
  assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
  assert.equal(actions(db).filter((a) => a === 'user.password_recovered').length, 1);
});

test('separation: the first-run code and the recovery code never stand in for each other', async (t) => {
  const { db, dir, cleanup } = await createTestDb();
  t.after(cleanup);
  ensureFirstRunCode(db, dir);
  const firstRun = fs.readFileSync(path.join(dir, FIRST_RUN_FILE), 'utf8');
  rotateRecoveryCode(db, dir, T0);
  const recovery = readActiveRecoveryCode(db, dir);
  assert.ok(recovery.ok);
  assert.equal((await createFirstAccount(db, dir, recovery.code, 'staff.one', OLD, T0)).ok, false);
  assert.ok((await createFirstAccount(db, dir, firstRun, 'staff.one', OLD, T0)).ok);
  assert.deepEqual(await recoverPassword(db, dir, 'staff.one', firstRun, NEW, T0), { ok: false, reason: 'invalid' });
  assert.ok(readActiveRecoveryCode(db, dir).ok, 'first-run cleanup leaves the recovery file alone');
});
