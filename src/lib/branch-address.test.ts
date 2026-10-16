import test from 'node:test';
import assert from 'node:assert/strict';
import { branchAddresses, canonicalOrigin } from './branch-address.ts';

test('phones get the configured https origin and its setup page; none without one', () => {
  const ts = 'https://office-pc.example-tailnet.ts.net';
  assert.deepEqual(branchAddresses(ts), { secure: ts, setup: `${ts}/setup` });
  assert.deepEqual(branchAddresses(null), { secure: null, setup: null });
});

test('BRANCH_URL must be a bare https origin', () => {
  assert.equal(canonicalOrigin(' https://office-pc.example-tailnet.ts.net/ '), 'https://office-pc.example-tailnet.ts.net');
  assert.equal(canonicalOrigin('https://office-pc.example-tailnet.ts.net:8443'), 'https://office-pc.example-tailnet.ts.net:8443');
  for (const bad of ['', undefined, 'http://office-pc.ts.net', 'office-pc.ts.net', 'https://office-pc.ts.net/scan', 'https://a:b@office-pc.ts.net', 'https://x.ts.net/?q=1']) {
    assert.equal(canonicalOrigin(bad), null, String(bad));
  }
});
