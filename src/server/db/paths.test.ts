import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isInsideAny, PROJECT_ROOT, resolveDataDir } from './paths.ts';
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
