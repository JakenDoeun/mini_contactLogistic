import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNextPath } from './safe-next.ts';

test('after sign-in, only a path on this site is followed', () => {
  assert.equal(safeNextPath('/parcels?q=CB1'), '/parcels?q=CB1');
  assert.equal(safeNextPath('/settings'), '/settings');
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'parcels', '', null, undefined, 42, '/login', '/login?next=/x', '/\nx']) {
    assert.equal(safeNextPath(bad), '/dashboard', String(bad));
  }
});
