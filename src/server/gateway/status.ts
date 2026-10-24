// Settings' view of the gateway: is it set up, can it be reached, does the password work, is the phone ready,
// and a test SMS to a staff number with the state the phone reports (Phase 8 gate); since Phase 12 from the SIM the
// number's carrier would use, from one chosen SIM, or one from each SIM.
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
import { readSetting, writeSetting } from '../db/settings.ts';
import { carrierLabel } from '../../lib/carriers.ts';
import { routeFor, scanSims } from './sims.ts';

export const TEST_KEY = 'gateway.test_sms';
export const TEST_TEXT = 'Campus Branch test message. No reply needed.';
const testText = (sim: number | null, carrier: string | null) =>
  sim === null ? TEST_TEXT : `Campus Branch test from SIM ${sim}${carrier ? ` (${carrier})` : ''}. No reply needed.`;
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
  /** The SIM slot it was sent from (Phase 12); null when the phone chose. */
  sim?: number | null;
}

/** Which SIM sends a test: the one the number's carrier would use, one chosen slot, or one from each SIM. */
export type TestSim = 'auto' | 'both' | number;

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

/** The last test: one SMS, or one per SIM ("both"). A test saved before Phase 12 is one SMS. */
export const lastTestSms = (db: Db): TestSms[] => {
  const t = readSetting(db, TEST_KEY) as TestSms | TestSms[] | undefined;
  return t ? (Array.isArray(t) ? t : [t]) : [];
};

const refusal = (error: string, message: string) => ({ ok: false as const, error, message });

export async function sendTestSms(db: Db, dataDir: string, userId: number, phone: string, sim: TestSim = 'auto', make = smsGate) {
  const to = toInternational(phone);
  if (!to) return refusal('invalid_phone', 'Enter a full phone number, for example 012 345 678.');
  const o = open(dataDir, make);
  if (!o.gate) return refusal('not_configured', 'The gateway is not set up yet.');
  const scan = await scanSims(db, dataDir, make);
  const label = (n: number) => {
    const s = scan.sims.find((x) => x.simNumber === n);
    return s?.carrier ? carrierLabel(s.carrier) : (s?.carrierName ?? null);
  };
  let sims: (number | null)[];
  if (scan.sims.length === 0) sims = [null]; // no SIM list (no Phone permission, or an older phone): the phone chooses
  else if (sim === 'both') sims = scan.sims.map((s) => s.simNumber);
  else if (sim === 'auto') {
    const n = routeFor(scan)(phone);
    if (n === null) return refusal('no_sim', 'No SIM in the gateway phone is set up for this number\'s carrier. A customer on it would be on Contact by hand.');
    sims = [n];
  } else {
    if (!scan.sims.some((s) => s.simNumber === sim)) return refusal('sim_missing', `SIM ${sim} is not in the gateway phone.`);
    sims = [sim];
  }

  const tests: TestSms[] = [];
  for (const n of sims) {
    const at = nowIso();
    const id = crypto.randomUUID();
    try {
      const result = await o.gate.send({ id, phone, text: testText(n, n === null ? null : label(n)), simNumber: n });
      tests.push({ id, toEnding: to.slice(-3), sentAt: at, state: result.outcome === 'accepted' ? 'Pending' : 'Unknown', states: {}, error: null, checkedAt: at, sim: n });
      writeAudit(db, { action: 'gateway.test_sent', entity: 'gateway', entityIds: n === null ? [] : [n], outcome: 'ok', userId, at, detail: { status_to: tests.at(-1)!.state } });
    } catch (e) {
      if (!(e instanceof GatewayError)) throw e;
      writeAudit(db, { action: 'gateway.test_sent', entity: 'gateway', entityIds: n === null ? [] : [n], outcome: 'failed', userId, at, detail: { error_code: e.problem } });
      if (!tests.length) return refusal(e.problem, e.message);
      break; // the first went out; the page shows it, and the error shows on the next check
    }
  }
  writeSetting(db, TEST_KEY, tests, userId, nowIso());
  return { ok: true as const, tests };
}

/** Asks the phone for the last test's states until they are final, and keeps what it says. */
export async function refreshTestSms(db: Db, dataDir: string, make = smsGate): Promise<TestSms[]> {
  const tests = lastTestSms(db);
  if (tests.every((t) => FINAL_STATES.includes(t.state as GatewayState) || t.state === 'Missing')) return tests;
  const o = open(dataDir, make);
  if (!o.gate) return tests;
  const next: TestSms[] = [];
  try {
    for (const test of tests) {
      if (FINAL_STATES.includes(test.state as GatewayState) || test.state === 'Missing') {
        next.push(test);
        continue;
      }
      const found = await o.gate.lookup(test.id);
      const at = nowIso();
      // A timed-out send not found within two minutes never reached the phone.
      const missing = !found && (test.state !== 'Unknown' || Date.parse(at) - Date.parse(test.sentAt) > 120_000);
      next.push(
        found
          ? { ...test, state: found.state, states: found.states, error: found.error, checkedAt: at }
          : { ...test, state: missing ? 'Missing' : test.state, checkedAt: at },
      );
    }
  } catch (e) {
    if (!(e instanceof GatewayError)) throw e;
    return tests; // the phone is unreachable for now; the stored states stay as they were
  }
  writeSetting(db, TEST_KEY, next, null, nowIso());
  return next;
}
