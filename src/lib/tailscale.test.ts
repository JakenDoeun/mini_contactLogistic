import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseByAddress, diagnoseTailscale, parseServe, parseStatus, pinnedLookup, type HttpsProbe, type TailscaleStatus } from './tailscale.ts';

// Shapes as printed by tailscale 1.102 (`status --json`, `serve status --json`), trimmed to the fields read.
const HOST = 'office-pc.example-tailnet.ts.net';

test('status: offline, certificates not yet enabled', () => {
  const s = parseStatus({ BackendState: 'Running', Self: { DNSName: `${HOST}.`, Online: false }, CertDomains: null });
  assert.deepEqual(s, { state: 'Running', online: false, hostname: HOST, ip: null, magicDNS: false, httpsCertificates: false });
  assert.equal(parseStatus({ CurrentTailnet: { MagicDNSEnabled: true } }).magicDNS, true);
});

test('status: online with HTTPS certificates for this host', () => {
  const s = parseStatus({ BackendState: 'Running', Self: { DNSName: `${HOST}.`, Online: true }, CertDomains: [HOST] });
  assert.equal(s.httpsCertificates, true);
  assert.equal(parseStatus({}).hostname, null);
});

test('serve: the https root of this host, and Funnel flagged', () => {
  const serve = { TCP: { '443': { HTTPS: true } }, Web: { [`${HOST}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } } };
  assert.deepEqual(parseServe(serve, HOST), { serveTarget: 'http://127.0.0.1:3000', funnel: false });
  assert.deepEqual(parseServe({}, HOST), { serveTarget: null, funnel: false });
  assert.equal(parseServe(serve, 'other-host.ts.net').serveTarget, null);
  assert.equal(parseServe({ ...serve, AllowFunnel: { [`${HOST}:443`]: true } }, HOST).funnel, true);
});

// ---- diagnosis -------------------------------------------------------------------------------------------------
const NOW = new Date('2026-10-12T12:00:00Z');
const healthy: TailscaleStatus = {
  installed: true,
  ip: '100.64.0.1',
  state: 'Running',
  online: true,
  hostname: HOST,
  magicDNS: true,
  httpsCertificates: true,
  serveTarget: 'http://127.0.0.1:3000',
  funnel: false,
};
const goodProbe: HttpsProbe = { ok: true, status: 200, thisApp: true, issuer: "Let's Encrypt YE1", validTo: '2027-01-10T04:32:09.000Z' };
const auto = { origin: `https://${HOST}`, source: 'tailscale' as const };
const states = (checks: ReturnType<typeof diagnoseTailscale>) => Object.fromEntries(checks.map((c) => [c.id, c.state]));

test('diagnosis: everything in place, certificate checked live', () => {
  const checks = diagnoseTailscale(healthy, goodProbe, auto, '3000', NOW);
  assert.ok(checks.every((c) => c.state === 'ok'), JSON.stringify(checks));
  assert.match(checks.find((c) => c.id === 'https')!.detail, /Let's Encrypt.*valid 89 more days.*renews it automatically/);
});

test('diagnosis: missing pieces each name their own fix, and later steps wait', () => {
  assert.deepEqual(states(diagnoseTailscale({ installed: false }, null, { origin: null, source: null }, '3000', NOW)), { tailscale: 'fail' });
  const approval = diagnoseTailscale({ ...healthy, state: 'NeedsMachineAuth' }, null, { origin: null, source: null }, '3000', NOW);
  assert.match(approval[0].fix!, /Machines/);
  assert.equal(approval.length, 1);

  const fresh = diagnoseTailscale(
    { ...healthy, magicDNS: false, httpsCertificates: false, serveTarget: null },
    null,
    { origin: null, source: null },
    '3000',
    NOW,
  );
  assert.deepEqual(states(fresh), { tailscale: 'ok', online: 'ok', magicdns: 'fail', certificates: 'fail', serve: 'fail', https: 'skip', address: 'warn' });
  assert.match(fresh.find((c) => c.id === 'serve')!.fix!, /tailscale serve --bg 3000/);
  assert.match(fresh.find((c) => c.id === 'certificates')!.fix!, /HTTPS Certificates/);
});

test('diagnosis: offline host, Funnel, and Serve or certificate errors', () => {
  assert.equal(states(diagnoseTailscale({ ...healthy, online: false }, goodProbe, auto, '3000', NOW)).online, 'fail');
  const funnel = diagnoseTailscale({ ...healthy, funnel: true }, null, { origin: null, source: null }, '3000', NOW);
  assert.match(funnel.find((c) => c.id === 'serve')!.fix!, /serve reset/);
  const badGateway = diagnoseTailscale(healthy, { ...goodProbe, status: 502, thisApp: false }, auto, '3000', NOW);
  assert.match(badGateway.find((c) => c.id === 'https')!.detail, /cannot reach the app/);
  const tls = diagnoseTailscale(healthy, { ok: false, reason: 'tls', message: 'CERT_HAS_EXPIRED' }, auto, '3000', NOW);
  assert.match(tls.find((c) => c.id === 'https')!.fix!, /up to a minute/);
  const expiring = diagnoseTailscale(healthy, { ...goodProbe, validTo: '2026-10-20T00:00:00Z' }, auto, '3000', NOW);
  assert.equal(states(expiring).https, 'warn');
});

test('diagnosis: BRANCH_URL copied from another installation is flagged', () => {
  const other = { origin: 'https://other-pc.other-tailnet.ts.net', source: 'BRANCH_URL' as const };
  const checks = diagnoseTailscale(healthy, goodProbe, other, '3000', NOW);
  assert.equal(states(checks).address, 'warn');
  assert.match(checks.find((c) => c.id === 'address')!.detail, /this computer is office-pc/);
  const invalid = diagnoseTailscale(healthy, goodProbe, { origin: null, source: null, invalidBranchUrl: 'office-pc' }, '3000', NOW);
  assert.equal(states(invalid).address, 'fail');
});

test('diagnosis by address: Windows hides Tailscale status from the app account, the live check decides', () => {
  const set = { origin: `https://${HOST}`, source: 'BRANCH_URL' as const };
  const good = diagnoseByAddress(goodProbe, set, '3000', NOW);
  assert.deepEqual(states(good), { tailscale: 'ok', https: 'ok', address: 'ok' });
  assert.match(good[0].detail, /Funnel cannot be checked/);
  const down = diagnoseByAddress({ ok: false, reason: 'refused', message: 'ECONNREFUSED' }, set, '3000', NOW);
  assert.deepEqual(states(down), { tailscale: 'warn', https: 'fail', address: 'ok' });
  assert.match(down[0].fix!, /Tailscale icon/);
});

test('the live check uses the Tailscale IPv4 address, not this computer\'s DNS', () => {
  const s = parseStatus({ Self: { DNSName: `${HOST}.`, TailscaleIPs: ['fd7a:115c:a1e0::1', '100.64.0.7'] } });
  assert.equal(s.ip, '100.64.0.7');
  assert.equal(parseStatus({ Self: { TailscaleIPs: ['fd7a:115c:a1e0::1'] } }).ip, null);
  const lookup = pinnedLookup('100.64.0.7');
  lookup(HOST, {}, (err, address, family) => assert.deepEqual([err, address, family], [null, '100.64.0.7', 4]));
  lookup(HOST, { all: true }, (err, address) => assert.deepEqual([err, address], [null, [{ address: '100.64.0.7', family: 4 }]]));
});
