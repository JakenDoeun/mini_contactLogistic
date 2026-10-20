import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createUser } from '../auth/accounts.ts';
import { createTestDb } from '../db/test-db.ts';
import { GATEWAY_FILE, gatewayConfigErrors, readGatewayConfig, smsGate, toInternational, writeGatewayConfig } from './smsgate.ts';
import { gatewayStatus, lastTestSms, refreshTestSms, sendTestSms } from './status.ts';

// A stand-in for SMSGate's Local Server with the behaviour recorded on the emulator (docs/smsgate-verification.md).
function fakeGateway(opts: { clockAheadMs?: number; healthy?: boolean; hangSend?: boolean } = {}) {
  const messages = new Map<string, { id: string; state: string; states: Record<string, string>; recipients: { phoneNumber: string }[] }>();
  const settings = { messages: { log_lifetime_days: undefined as number | undefined } };
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const send = (status: number, value?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', date: new Date(Date.now() + (opts.clockAheadMs ?? 0)).toUTCString() });
      res.end(value === undefined ? '' : JSON.stringify(value));
    };
    if (req.url === '/health') {
      const ok = opts.healthy ?? true;
      return send(ok ? 200 : 500, { status: ok ? 'pass' : 'fail', version: '1.77.3', checks: { 'battery:level': { observedValue: 80, status: 'pass' } } });
    }
    if (req.headers.authorization !== `Basic ${Buffer.from('sms:secret').toString('base64')}`) return send(401);
    const url = new URL(req.url!, 'http://x');
    if (req.method === 'POST' && url.pathname === '/messages') {
      const m = JSON.parse(body);
      if (messages.has(m.id)) return send(409, { message: 'Message with the same ID already exists' });
      const at = new Date().toISOString();
      messages.set(m.id, { id: m.id, state: 'Delivered', states: { Pending: at, Sent: at, Delivered: at }, recipients: m.phoneNumbers.map((p: string) => ({ phoneNumber: p })) });
      if (opts.hangSend) return; // the phone took it but never answered
      return send(202, messages.get(m.id));
    }
    if (url.pathname === '/messages') return send(200, [...messages.values()]);
    if (url.pathname.startsWith('/messages/')) {
      const m = messages.get(decodeURIComponent(url.pathname.slice(10)));
      return m ? send(200, m) : send(404);
    }
    if (url.pathname === '/settings' && req.method === 'GET') return send(200, settings);
    if (url.pathname === '/settings' && req.method === 'PATCH') {
      settings.messages.log_lifetime_days = JSON.parse(body).messages.log_lifetime_days;
      return send(200, settings);
    }
    send(404);
  });
  return new Promise<{ url: string; messages: typeof messages; settings: typeof settings; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, messages, settings, close: () => server.close() });
    }),
  );
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-'));

test('the settings file is written for this account only and read back; incomplete values are named', () => {
  const dir = tempDir();
  assert.equal(readGatewayConfig(dir), null);
  writeGatewayConfig(dir, { url: 'http://phone:8080/', username: ' sms ', password: 'p w' });
  assert.deepEqual(readGatewayConfig(dir), { url: 'http://phone:8080', username: 'sms', password: 'p w' });
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, GATEWAY_FILE)).mode & 0o777, 0o600);
  assert.deepEqual(gatewayConfigErrors({ url: 'phone:8080', username: '', password: '' }).length, 3);
  assert.equal(toInternational('012 345 678'), '+85512345678');
  assert.equal(toInternational('12345'), null);
});

test('send, the same ID again, lookup, an unknown ID, a wrong password and Delete after', async () => {
  const gw = await fakeGateway();
  try {
    const gate = smsGate({ url: gw.url, username: 'sms', password: 'secret' });
    assert.deepEqual(await gate.send({ id: 'a1', phone: '012 345 678', text: 'hi' }), { outcome: 'accepted', duplicate: false });
    assert.equal(gw.messages.get('a1')!.recipients[0].phoneNumber, '+85512345678');
    // A resend under the same ID is refused by the phone (409) and nothing new is sent.
    assert.deepEqual(await gate.send({ id: 'a1', phone: '012 345 678', text: 'hi' }), { outcome: 'accepted', duplicate: true });
    assert.equal(gw.messages.size, 1);
    assert.equal((await gate.lookup('a1'))!.state, 'Delivered');
    assert.equal(await gate.lookup('never-sent'), null);
    await assert.rejects(smsGate({ url: gw.url, username: 'sms', password: 'wrong' }).checkLogin(), { problem: 'auth' });
    assert.equal(await gate.ensureDeleteAfter(), true);
    assert.equal(gw.settings.messages.log_lifetime_days, 7);
    assert.equal(await gate.ensureDeleteAfter(), false);
  } finally {
    gw.close();
  }
});

test('a send that times out is "unknown", never failed; the ID is found afterwards', async () => {
  const gw = await fakeGateway({ hangSend: true });
  try {
    const slowFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(300) });
    const gate = smsGate({ url: gw.url, username: 'sms', password: 'secret' }, slowFetch);
    const result = await gate.send({ id: 'slow', phone: '012345678', text: 'hi' });
    assert.equal(result.outcome, 'unknown');
    assert.equal((await gate.lookup('slow'))!.state, 'Delivered');
  } finally {
    gw.close();
  }
});

test('an unreachable phone is reported as such, not as a send result', async () => {
  const gate = smsGate({ url: 'http://127.0.0.1:9', username: 'sms', password: 'secret' });
  await assert.rejects(gate.send({ id: 'x', phone: '012345678', text: 'hi' }), { problem: 'unreachable' });
});

test('status: not set up, connected with the phone clock and Delete after, a failing phone, a wrong password', async () => {
  const dir = tempDir();
  assert.deepEqual(await gatewayStatus(dir), { configured: false, problem: undefined });
  const gw = await fakeGateway({ clockAheadMs: 5 * 60_000 });
  try {
    writeGatewayConfig(dir, { url: gw.url, username: 'sms', password: 'secret' });
    const ok = await gatewayStatus(dir);
    assert.ok(ok.configured && !ok.problem && ok.health!.ready);
    assert.ok(ok.configured && Math.abs(ok.health!.clockOffsetSeconds! - 300) <= 2, 'phone clock 5 minutes ahead');
    assert.ok(ok.configured && ok.deleteAfterSet);
    writeGatewayConfig(dir, { url: gw.url, username: 'sms', password: 'wrong' });
    const wrong = await gatewayStatus(dir);
    assert.equal(wrong.configured && wrong.problem?.kind, 'auth');
  } finally {
    gw.close();
  }
  const sick = await fakeGateway({ healthy: false });
  try {
    writeGatewayConfig(dir, { url: sick.url, username: 'sms', password: 'secret' });
    const s = await gatewayStatus(dir);
    assert.ok(s.configured && !s.problem && s.health!.ready === false, 'HTTP 500 from /health is "not ready", not an error');
  } finally {
    sick.close();
  }
});

test('a test SMS keeps only the last digits, is audited without the number, and follows the phone to Delivered', async () => {
  const { db, cleanup } = await createTestDb();
  const dir = tempDir();
  const gw = await fakeGateway();
  const created = await createUser(db, 'admin.one', 'correct horse battery staple', 'cli');
  assert.ok(created.ok);
  const userId = created.userId;
  try {
    assert.equal((await sendTestSms(db, dir, userId, '012 345 678')).ok, false, 'not set up');
    writeGatewayConfig(dir, { url: gw.url, username: 'sms', password: 'secret' });
    assert.equal((await sendTestSms(db, dir, userId, '123')).ok, false, 'not a full number');
    const sent = await sendTestSms(db, dir, userId, '012 345 678');
    assert.ok(sent.ok);
    assert.equal(sent.test.toEnding, '678');
    assert.doesNotMatch(JSON.stringify(lastTestSms(db)), /345/);
    const audit = db.prepare("SELECT outcome, detail FROM audit_log WHERE action = 'gateway.test_sent'").all() as { outcome: string; detail: string }[];
    assert.equal(audit.length, 1);
    assert.doesNotMatch(audit[0].detail, /345/);
    assert.equal((await refreshTestSms(db, dir))!.state, 'Delivered');
  } finally {
    gw.close();
    cleanup();
  }
});
