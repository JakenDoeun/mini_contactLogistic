import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { broadAccess, isInsideAny, PROJECT_ROOT, resolveDataDir } from './paths.ts';
import { makeTempDir, removeTempDir } from './test-db.ts';

test('a production server without DATA_DIR is refused instead of using the development folder (finding M2)', (t) => {
  const dir = makeTempDir();
  t.after(() => removeTempDir(dir));
  assert.throws(() => resolveDataDir({ NODE_ENV: 'production' }), /DATA_DIR is not set/);
  assert.throws(() => resolveDataDir({ NODE_ENV: 'production', DATA_DIR: '  ' }), /DATA_DIR is not set/);
  assert.equal(resolveDataDir({ NODE_ENV: 'production', DATA_DIR: path.join(dir, 'data') }), path.join(dir, 'data'));
});

test('production folders are recognised by real path, through a symlink too (finding L1)', (t) => {
  const dir = makeTempDir();
  t.after(() => removeTempDir(dir));
  const production = path.join(dir, 'production');
  fs.mkdirSync(production);
  fs.symlinkSync(production, path.join(dir, 'alias'));
  assert.equal(isInsideAny(path.join(dir, 'alias'), [production]), true);
  assert.equal(isInsideAny(path.join(dir, 'alias', 'not-yet-created'), [production]), true);
  assert.equal(isInsideAny(production, [path.join(dir, 'alias')]), true);
  assert.equal(isInsideAny(path.join(dir, 'production-other'), [production]), false);
});

test('the demo seed refuses to run in production mode (finding L1)', (t) => {
  const dir = makeTempDir();
  t.after(() => removeTempDir(dir));
  const result = spawnSync(process.execPath, ['scripts/db-seed.ts'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, NODE_ENV: 'production', DATA_DIR: path.join(dir, 'data') },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to seed demo data in production/);
  assert.equal(fs.existsSync(path.join(dir, 'data')), false, 'nothing created');
});

test('Windows: a data folder open to everyday accounts is refused, the installer\'s access list is not (finding I4)', () => {
  // As icacls /save prints them: the installer's list (protected, app account + Administrators + SYSTEM) ...
  const installer = 'D:PAI(A;OICI;0x1301bf;;;S-1-5-21-1004336348-1177238915-682003330-1001)(A;OICI;FA;;;BA)(A;OICI;FA;;;SY)';
  assert.deepEqual(broadAccess(installer), []);
  // ... and ProgramData's default, inherited by a folder made by hand.
  const byHand = 'D:AI(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIIOID;GA;;;CO)(A;OICIID;0x1200a9;;;BU)(A;CIID;DCLCRPCR;;;BU)';
  assert.deepEqual(broadAccess(byHand), ['Users']);
  assert.deepEqual(broadAccess('D:(A;;FA;;;WD)(D;;FA;;;AU)(A;;FA;;;S-1-5-11)'), ['Everyone', 'Authenticated Users']); // deny entries ignored
});
