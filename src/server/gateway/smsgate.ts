// The SMSGate Local Server on the gateway phone, built to the behaviour checked in Phase 7
// (docs/smsgate-verification.md, emulator results): a repeated message ID is refused with 409, a message can be
// looked up by ID (404 when the phone never got it), /health answers without a password (HTTP 500 when a check
// fails), and every answer's Date header carries the phone's clock. A send that times out may still have reached
// the phone, so its outcome is "unknown" and the caller looks the ID up; it never sends again under a new ID.
import fs from 'node:fs';
import path from 'node:path';
import { isValidPhone, normalizePhone } from '../../lib/parcel-logic.ts';
import { translate } from '../../lib/messages.ts';
import { gatewayUrlError } from '../../lib/settings-logic.ts';

// The address and password live in this file in the data folder (0600), never in the database or Settings
// (docs/phase1-schema.md, "When restricted configuration becomes mandatory"). npm run gateway writes it.
export const GATEWAY_FILE = 'gateway.json';
export const DELETE_AFTER_DAYS = 7; // owner, 2026-10-19: the phone keeps sent messages 7 days
const TIMEOUT_MS = 8000;

export interface GatewayConfig {
  url: string;
  username: string;
  password: string;
}

export function readGatewayConfig(dataDir: string): GatewayConfig | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dataDir, GATEWAY_FILE), 'utf8');
  } catch {
    return null;
  }
  const c = JSON.parse(raw) as Partial<GatewayConfig>;
  if (typeof c.url !== 'string' || typeof c.username !== 'string' || typeof c.password !== 'string') {
    throw new Error(`${GATEWAY_FILE} is incomplete. Run npm run gateway -- set again.`);
  }
  return { url: c.url, username: c.username, password: c.password };
}

/** Problems with the values, as sentences; empty when they can be saved. */
export function gatewayConfigErrors(c: GatewayConfig): string[] {
  const errors: string[] = [];
  const urlError = c.url.trim() ? gatewayUrlError(c.url) : null;
  if (!c.url.trim()) errors.push('Enter the address shown in the gateway app.');
  if (urlError) errors.push(translate('en', urlError.key, urlError.vars));
  if (!c.username.trim()) errors.push('Enter the username shown in the gateway app.');
  if (!c.password) errors.push('Enter the password shown in the gateway app.');
  return errors;
}

export function writeGatewayConfig(dataDir: string, c: GatewayConfig) {
  const file = path.join(dataDir, GATEWAY_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  const value = { url: c.url.trim().replace(/\/+$/, ''), username: c.username.trim(), password: c.password };
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

/** 012 345 678 → +85512345678. Null when the number is not a full Cambodian number. */
export const toInternational = (phone: string) => (isValidPhone(phone) ? `+855${normalizePhone(phone).slice(1)}` : null);

export type GatewayState = 'Pending' | 'Processed' | 'Sent' | 'Delivered' | 'Failed';
export interface MessageState {
  id: string;
  state: GatewayState;
  /** When the phone reached each state, in the phone's clock. */
  states: Partial<Record<GatewayState, string>>;
  error: string | null;
}

export interface SimCard {
  simNumber: number;
  carrierName: string | null;
  phoneNumber: string | null;
}

export type Problem = 'unreachable' | 'timeout' | 'auth' | 'refused';
export class GatewayError extends Error {
  readonly problem: Problem;
  constructor(problem: Problem, message: string) {
    super(message);
    this.problem = problem;
  }
}

export interface Health {
  /** All of the phone's own checks pass (signal, battery, recent failures). */
  ready: boolean;
  version: string | null;
  checks: Record<string, { description?: string; observedValue: number; status: string }>;
  /** Phone clock minus this computer's clock, in seconds, from the Date header. Null when the phone sent none. */
  clockOffsetSeconds: number | null;
}

export type SendResult = { outcome: 'accepted'; duplicate: boolean } | { outcome: 'unknown'; reason: string };

export function smsGate(config: GatewayConfig, fetchImpl: typeof fetch = fetch) {
  const base = config.url.replace(/\/+$/, '');
  const authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;

  async function call(route: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS) {
    try {
      return await fetchImpl(base + route, {
        ...init,
        headers: { authorization, ...(init.body ? { 'content-type': 'application/json' } : {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timedOut = (e as Error).name === 'TimeoutError';
      throw new GatewayError(
        timedOut ? 'timeout' : 'unreachable',
        timedOut ? 'The gateway phone did not answer in time.' : 'The gateway phone could not be reached. Check that it is on and connected.',
      );
    }
  }

  async function expectOk(res: Response) {
    if (res.status === 401 || res.status === 403) throw new GatewayError('auth', 'The gateway refused the username or password.');
    if (!res.ok) throw new GatewayError('refused', `The gateway answered ${res.status}. ${await res.text().catch(() => '')}`.trim());
    return res;
  }

  return {
    /** The phone's own readiness checks. /health needs no password, so this also proves nothing about it. */
    async health(): Promise<Health> {
      const sentAt = Date.now();
      const res = await call('/health');
      if (res.status !== 200 && res.status !== 500 && res.status !== 503) await expectOk(res);
      const body = (await res.json()) as { status?: string; version?: string; checks?: Health['checks'] };
      const date = res.headers.get('date');
      // The header has whole seconds; compare it with the middle of the round trip.
      const offset = date ? Math.round((Date.parse(date) - (sentAt + Date.now()) / 2) / 1000) : null;
      return { ready: body.status === 'pass', version: body.version ?? null, checks: body.checks ?? {}, clockOffsetSeconds: offset };
    },

    /** Proves the username and password: a cheap list call that needs them. */
    async checkLogin() {
      await expectOk(await call('/messages?limit=1'));
    },

    /** The phone's active SIMs, as SMSGate reports them (carrier name and number need its Phone permission). */
    async sims(): Promise<SimCard[]> {
      const devices = (await (await expectOk(await call('/device'))).json()) as { simCards?: Partial<SimCard>[] }[];
      return (devices[0]?.simCards ?? [])
        .filter((c) => Number.isInteger(c.simNumber) && c.simNumber! >= 1 && c.simNumber! <= 8)
        .map((c) => ({ simNumber: c.simNumber!, carrierName: c.carrierName?.trim() || null, phoneNumber: c.phoneNumber?.trim() || null }));
    },

    /** Hands one SMS to the phone under our own ID, from the given SIM slot (1-based) or the phone's default. */
    async send(message: { id: string; phone: string; text: string; simNumber?: number | null }): Promise<SendResult> {
      const to = toInternational(message.phone);
      if (!to) throw new GatewayError('refused', 'Not a full Cambodian phone number.');
      let res: Response;
      try {
        res = await call('/messages', {
          method: 'POST',
          body: JSON.stringify({
            id: message.id,
            phoneNumbers: [to],
            textMessage: { text: message.text },
            withDeliveryReport: true,
            ...(message.simNumber ? { simNumber: message.simNumber } : {}),
          }),
        });
      } catch (e) {
        if (e instanceof GatewayError && e.problem === 'timeout') return { outcome: 'unknown', reason: e.message };
        throw e; // unreachable: the request never left this computer
      }
      if (res.status === 202) return { outcome: 'accepted', duplicate: false };
      if (res.status === 409) return { outcome: 'accepted', duplicate: true }; // the phone already has this ID
      // Offline or at its own sending limit: the phone kept nothing, so the message can wait and go later.
      if (res.status === 503) throw new GatewayError('unreachable', 'The gateway phone is not ready to send right now.');
      await expectOk(res);
      return { outcome: 'accepted', duplicate: false };
    },

    /** The phone's record of one message, or null when it has none (never received, or deleted after the set days). */
    async lookup(id: string): Promise<MessageState | null> {
      const res = await call(`/messages/${encodeURIComponent(id)}`);
      if (res.status === 404) return null;
      await expectOk(res);
      const m = (await res.json()) as { id: string; state: GatewayState; states?: MessageState['states']; recipients?: { error?: string }[] };
      return { id: m.id, state: m.state, states: m.states ?? {}, error: m.recipients?.find((r) => r.error)?.error ?? null };
    },

    /** Makes the phone delete its sent messages after `days`. Returns true when it had to change the setting. */
    async ensureDeleteAfter(days = DELETE_AFTER_DAYS) {
      const current = (await (await expectOk(await call('/settings'))).json()) as { messages?: { log_lifetime_days?: number } };
      if (current.messages?.log_lifetime_days === days) return false;
      await expectOk(await call('/settings', { method: 'PATCH', body: JSON.stringify({ messages: { log_lifetime_days: days } }) }));
      return true;
    },
  };
}

export type SmsGate = ReturnType<typeof smsGate>;
export const FINAL_STATES: GatewayState[] = ['Delivered', 'Failed'];
