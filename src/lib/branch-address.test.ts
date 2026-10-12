import test from 'node:test';
import assert from 'node:assert/strict';
import { branchAddresses, canonicalOrigin } from './branch-address.ts';

// The legacy cases are all LAN mode; check that once here, then compare the addresses alone.
const lan = ({ mode, ...addresses }: ReturnType<typeof branchAddresses>) => {
  assert.equal(mode, 'lan');
  return addresses;
};
const req = (h: Record<string, string>) => lan(branchAddresses(new Headers(h)));

test('behind Caddy on the default ports, addresses carry no port', () => {
  const https = req({ host: '192.168.1.20', 'x-forwarded-proto': 'https', 'x-branch-http-port': '80' });
  assert.deepEqual(https, { secure: 'https://192.168.1.20', setup: 'http://192.168.1.20/setup' });
  const http = req({ host: '192.168.1.20', 'x-forwarded-proto': 'http', 'x-branch-https-port': '443' });
  assert.deepEqual(http, https);
});

test('behind Caddy on changed ports, both addresses follow', () => {
  const fromHttps = req({ host: '192.168.1.20:8443', 'x-forwarded-proto': 'https', 'x-branch-http-port': '8080' });
  assert.deepEqual(fromHttps, { secure: 'https://192.168.1.20:8443', setup: 'http://192.168.1.20:8080/setup' });
  const fromHttp = req({ host: '192.168.1.20:8080', 'x-forwarded-proto': 'http', 'x-branch-https-port': '8443' });
  assert.deepEqual(fromHttp, fromHttps);
});

test('without Caddy, the setup address keeps the port the page was opened on', () => {
  assert.deepEqual(req({ host: '192.168.5.5:3000' }), { secure: null, setup: 'http://192.168.5.5:3000/setup' });
  assert.deepEqual(req({ host: '192.168.5.5:3000', 'x-forwarded-proto': 'https' }), {
    secure: 'https://192.168.5.5:3000',
    setup: 'https://192.168.5.5:3000/setup',
  });
});

test('localhost and junk give no phone address; junk ports are ignored', () => {
  assert.deepEqual(req({ host: 'localhost:3000' }), { secure: null, setup: null });
  assert.deepEqual(req({ host: '127.0.0.1' }), { secure: null, setup: null });
  assert.deepEqual(req({ host: 'a b' }), { secure: null, setup: null });
  assert.equal(req({ host: '10.0.0.2', 'x-branch-https-port': 'evil.com' }).secure, null);
});

test('opened directly on the app port while Caddy runs, the addresses use Caddy\'s ports', () => {
  const caddy = { httpPort: 8080, httpsPort: 8443 };
  assert.deepEqual(lan(branchAddresses(new Headers({ host: '172.20.10.3:3000' }), caddy)), {
    secure: 'https://172.20.10.3:8443',
    setup: 'http://172.20.10.3:8080/setup',
  });
  // Through Caddy its own headers win; the http side keeps the port the request came in on.
  const via = lan(branchAddresses(new Headers({ host: '172.20.10.3:9000', 'x-branch-https-port': '9443' }), caddy));
  assert.deepEqual(via, { secure: 'https://172.20.10.3:9443', setup: 'http://172.20.10.3:9000/setup' });
});

test('a configured https origin wins over the request, even on localhost or behind Caddy', () => {
  const ts = 'https://office-pc.example-tailnet.ts.net';
  const expected = { secure: ts, setup: `${ts}/setup`, mode: 'tailscale' };
  assert.deepEqual(branchAddresses(new Headers({ host: 'localhost:3000' }), undefined, ts), expected);
  assert.deepEqual(branchAddresses(new Headers({ host: '192.168.1.10:8080', 'x-branch-https-port': '8443' }), { httpPort: 8080, httpsPort: 8443 }, ts), expected);
});

test('BRANCH_URL must be a bare https origin', () => {
  assert.equal(canonicalOrigin(' https://office-pc.example-tailnet.ts.net/ '), 'https://office-pc.example-tailnet.ts.net');
  assert.equal(canonicalOrigin('https://office-pc.example-tailnet.ts.net:8443'), 'https://office-pc.example-tailnet.ts.net:8443');
  for (const bad of ['', undefined, 'http://office-pc.ts.net', 'office-pc.ts.net', 'https://office-pc.ts.net/scan', 'https://a:b@office-pc.ts.net', 'https://x.ts.net/?q=1']) {
    assert.equal(canonicalOrigin(bad), null, String(bad));
  }
});
