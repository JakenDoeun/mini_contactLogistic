// Settings' view of the gateway: is it set up, can it be reached, does the password work, is the phone ready,
// and one test SMS to a staff number with the state the phone reports (Phase 8 gate).
import crypto from 'node:crypto';
import { writeAudit } from '../db/audit.ts';
import type { Db } from '../db/connection.ts';
import { nowIso } from '../db/values.ts';
import {
  DELETE_AFTER_DAYS,
  FINAL_STATES,
  GatewayError,
  readGatewayConfig,
  smsGate,
  toInternational,
  type GatewayState,
  type Health,
  type Problem,
  type SmsGate,
} from './smsgate.ts';

export const TEST_KEY = 'gateway.test_sms';
export const TEST_TEXT = 'Campus Branch test message. No reply needed.';
// A phone clock this far off would put wrong times on messages (Revision 4: clock check, 10 minutes).
export const CLOCK_LIMIT_SECONDS = 10 * 60;

export interface TestSms {
  id: string;
  /** The last three digits only: the full number stays out of settings and the audit log. */
  toEnding: string;
  sentAt: string;
  /** The phone's state, 'Unknown' while a timed-out send is not found yet, 'Missing' once the phone has no record. */
  state: GatewayState | 'Unknown' | 'Missing';
  states: Partial<Record<GatewayState, string>>;
  error: string | null;
  checkedAt: string;
}

export type GatewayStatus =
  | { configured: false; problem?: string }
  | {
      configured: true;
      url: string;
      problem: { kind: Problem; message: string } | null;
      health: Health | null;
      /** True when this check had to set the phone's "Delete after" to DELETE_AFTER_DAYS. */
      deleteAfterSet: boolean;
      deleteAfterDays: number;
      clockLimitSeconds: number;
    };

function readSetting(db: Db, key: string): unknown {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : undefined;
}
const writeSetting = (db: Db, key: string, value: unknown, userId: number | null, at: string) =>
  db
    .prepare(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), userId, at);

type Open = { gate: SmsGate; url: string } | { gate: null; problem?: string };
function open(dataDir: string, make = smsGate): Open {
  try {
    const config = readGatewayConfig(dataDir);
    return config ? { gate: make(config), url: config.url } : { gate: null };
  } catch (e) {
    return { gate: null, problem: (e as Error).message };
  }
}

/** Reachable, password accepted, the phone's own checks, its clock, and "Delete after" kept at 7 days. */
export async function gatewayStatus(dataDir: string, make = smsGate): Promise<GatewayStatus> {
  const o = open(dataDir, make);
  if (!o.gate) return { configured: false, problem: o.problem };
  const status = { configured: true as const, url: o.url, health: null, deleteAfterSet: false, deleteAfterDays: DELETE_AFTER_DAYS, clockLimitSeconds: CLOCK_LIMIT_SECONDS };
  try {
    const health = await o.gate.health();
    await o.gate.checkLogin();
    const deleteAfterSet = await o.gate.ensureDeleteAfter();
    return { ...status, problem: null, health, deleteAfterSet };
  } catch (e) {
    if (!(e instanceof GatewayError)) throw e;
    return { ...status, problem: { kind: e.problem, message: e.message } };
  }
}

export const lastTestSms = (db: Db) => (readSetting(db, TEST_KEY) as TestSms | undefined) ?? null;

export async function sendTestSms(db: Db, dataDir: string, userId: number, phone: string, make = smsGate) {
  const to = toInternational(phone);
  if (!to) return { ok: false as const, error: 'invalid_phone', message: 'Enter a full phone number, for example 012 345 678.' };
  const o = open(dataDir, make);
  if (!o.gate) return { ok: false as const, error: 'not_configured', message: 'The gateway is not set up yet.' };
  const at = nowIso();
  const id = crypto.randomUUID();
  try {
    const result = await o.gate.send({ id, phone, text: TEST_TEXT });
    const test: TestSms = { id, toEnding: to.slice(-3), sentAt: at, state: result.outcome === 'accepted' ? 'Pending' : 'Unknown', states: {}, error: null, checkedAt: at };
    writeSetting(db, TEST_KEY, test, userId, at);
    writeAudit(db, { action: 'gateway.test_sent', entity: 'gateway', entityIds: [], outcome: 'ok', userId, at, detail: { status_to: test.state } });
    return { ok: true as const, test };
  } catch (e) {
    if (!(e instanceof GatewayError)) throw e;
    writeAudit(db, { action: 'gateway.test_sent', entity: 'gateway', entityIds: [], outcome: 'failed', userId, at, detail: { error_code: e.problem } });
    return { ok: false as const, error: e.problem, message: e.message };
  }
}

/** Asks the phone for the last test SMS's state until it is final, and keeps what it says. */
export async function refreshTestSms(db: Db, dataDir: string, make = smsGate): Promise<TestSms | null> {
  const test = lastTestSms(db);
  if (!test || FINAL_STATES.includes(test.state as GatewayState) || test.state === 'Missing') return test;
  const o = open(dataDir, make);
  if (!o.gate) return test;
  try {
    const found = await o.gate.lookup(test.id);
    const at = nowIso();
    // A timed-out send not found within two minutes never reached the phone.
    const missing = !found && (test.state !== 'Unknown' || Date.parse(at) - Date.parse(test.sentAt) > 120_000);
    const next: TestSms = found
      ? { ...test, state: found.state, states: found.states, error: found.error, checkedAt: at }
      : { ...test, state: missing ? 'Missing' : test.state, checkedAt: at };
    writeSetting(db, TEST_KEY, next, null, at);
    return next;
  } catch (e) {
    if (!(e instanceof GatewayError)) throw e;
    return test; // the phone is unreachable for now; the stored state stays as it was
  }
}
