// The gateway phone's SIMs (Phase 12, owner 2026-10-23). The app scans the phone for its SIMs; a staff member confirms
// once which carrier each SIM is. Each SMS then goes out from the SIM of its customer's carrier, and a customer whose
// carrier has no confirmed SIM in the phone right now is contacted by hand. There is no fallback SIM.
import { CARRIERS, carrierFromName, carrierOf, simByCarrier, type Carrier, type SimInfo } from '../../lib/carriers.ts';
import { isValidPhone, normalizePhone } from '../../lib/parcel-logic.ts';
import { writeAudit } from '../db/audit.ts';
import type { Db } from '../db/connection.ts';
import { readSetting, writeSetting } from '../db/settings.ts';
import { nowIso } from '../db/values.ts';
import { GatewayError, readGatewayConfig, smsGate, type Problem, type SimCard } from './smsgate.ts';

export const SIM_SCAN = 'sms.sim_scan';
export const SIM_CARRIERS = 'sms.sim_carriers';

interface Scan {
  at: string;
  cards: SimCard[];
}
interface Confirmation {
  simNumber: number;
  /** What the phone reported when it was confirmed: a SIM that reports something else is a different SIM. */
  carrierName: string | null;
  reportedNumber: string | null;
  carrier: Carrier;
  /** Typed by staff when the phone does not know it; display only. */
  ownNumber: string | null;
  confirmedBy: number | null;
  confirmedAt: string;
}

export interface SimState {
  scannedAt: string | null;
  sims: SimInfo[];
}

const confirmations = (db: Db) => (readSetting(db, SIM_CARRIERS) as Confirmation[] | undefined) ?? [];
const sameSim = (c: Confirmation, card: SimCard) => c.simNumber === card.simNumber && c.carrierName === card.carrierName && c.reportedNumber === card.phoneNumber;

/** The SIMs of the last scan, each with its confirmed carrier when the same SIM was confirmed before. */
export function simState(db: Db): SimState {
  const scan = readSetting(db, SIM_SCAN) as Scan | undefined;
  const confirmed = confirmations(db);
  return {
    scannedAt: scan?.at ?? null,
    sims: (scan?.cards ?? []).map((card) => {
      const c = confirmed.find((x) => sameSim(x, card));
      return {
        simNumber: card.simNumber,
        carrierName: card.carrierName,
        phoneNumber: card.phoneNumber ?? c?.ownNumber ?? null,
        suggested: carrierFromName(card.carrierName) ?? (card.phoneNumber ? carrierOf(card.phoneNumber) : null),
        carrier: c?.carrier ?? null,
      };
    }),
  };
}

/** The SIM slot for a customer's number, or null when their carrier has no confirmed SIM in the phone (contact by hand). */
export function routeFor(state: SimState) {
  const slot = simByCarrier(state.sims);
  return (phone: string) => {
    const carrier = carrierOf(phone);
    return carrier ? (slot.get(carrier) ?? null) : null;
  };
}

/** Asks the phone for its SIMs and keeps the answer; when the phone cannot be asked, the last scan stands. */
export async function scanSims(db: Db, dataDir: string, make = smsGate): Promise<SimState & { problem: string | null; problemKind?: Problem }> {
  let config;
  try {
    config = readGatewayConfig(dataDir);
  } catch (e) {
    return { ...simState(db), problem: (e as Error).message };
  }
  if (!config) return { ...simState(db), problem: 'The gateway is not set up yet.' };
  try {
    const cards = await make(config).sims();
    const before = readSetting(db, SIM_SCAN) as Scan | undefined;
    const at = nowIso();
    // Written only when the SIMs changed, or the stored scan is over a minute old, so a busy page does not churn the disk.
    if (!before || JSON.stringify(before.cards) !== JSON.stringify(cards) || Date.parse(at) - Date.parse(before.at) > 60_000) {
      writeSetting(db, SIM_SCAN, { at, cards }, null, at);
    }
    return { ...simState(db), problem: null };
  } catch (e) {
    if (!(e instanceof GatewayError)) throw e;
    return { ...simState(db), problem: e.message, problemKind: e.problem };
  }
}

export type ConfirmResult = { ok: true; state: SimState } | { ok: false; error: string; message: string };

/** A staff member says which carrier a scanned SIM is (any signed-in staff member, owner 2026-10-23); audited. */
export function confirmSim(db: Db, userId: number | null, input: { simNumber: unknown; carrier: unknown; ownNumber?: unknown }, at = nowIso()): ConfirmResult {
  const card = ((readSetting(db, SIM_SCAN) as Scan | undefined)?.cards ?? []).find((c) => c.simNumber === input.simNumber);
  if (!card) return { ok: false, error: 'not_found', message: 'This SIM is not in the gateway phone any more. Scan the SIMs again.' };
  if (!CARRIERS.includes(input.carrier as Carrier)) return { ok: false, error: 'invalid_request', message: 'Choose the carrier of this SIM.' };
  const own = typeof input.ownNumber === 'string' && input.ownNumber.trim() ? input.ownNumber : null;
  if (own !== null && !isValidPhone(own)) return { ok: false, error: 'invalid_phone', message: "Enter the SIM's full number, or leave it empty." };
  const next: Confirmation = {
    simNumber: card.simNumber,
    carrierName: card.carrierName,
    reportedNumber: card.phoneNumber,
    carrier: input.carrier as Carrier,
    ownNumber: own === null ? null : normalizePhone(own),
    confirmedBy: userId,
    confirmedAt: at,
  };
  db.transaction(() => {
    writeSetting(db, SIM_CARRIERS, [...confirmations(db).filter((c) => c.simNumber !== card.simNumber), next], userId, at);
    writeAudit(db, { action: 'gateway.sim_confirmed', entity: 'gateway', entityIds: [card.simNumber], outcome: 'ok', userId, at, detail: { status_to: next.carrier } });
  })();
  return { ok: true, state: simState(db) };
}
