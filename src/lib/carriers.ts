// Which carrier a Cambodian mobile number belongs to, from its first three digits (Phase 12). Pure, so the pages and
// the server use the same list. Source: Telecommunication Regulator of Cambodia, Mobile Phone Prefixes
// (https://www.trc.gov.kh/en/resources/mobile-prefixes/), read 2026-10-22. A new TRC range is added here.
import { isValidPhone, normalizePhone } from './parcel-logic.ts';

export const CARRIERS = ['cellcard', 'smart', 'metfone', 'seatel'] as const;
export type Carrier = (typeof CARRIERS)[number];

export const CARRIER_LABEL: Record<Carrier, string> = { cellcard: 'Cellcard', smart: 'Smart', metfone: 'Metfone', seatel: 'Seatel' };
export const PREFIXES_AS_OF = '2026-10-22';

const PREFIXES: Record<Carrier, string[]> = {
  cellcard: ['011', '012', '014', '017', '061', '076', '077', '078', '085', '089', '092', '095', '099'],
  smart: ['010', '015', '016', '069', '070', '081', '086', '087', '093', '096', '098'],
  metfone: ['031', '060', '066', '067', '068', '071', '088', '090', '097'],
  seatel: ['018'],
};
const BY_PREFIX = new Map(CARRIERS.flatMap((c) => PREFIXES[c].map((p) => [p, c] as const)));

/** The carrier of a phone number in any format, or null when the number is invalid or its prefix is not on the list. */
export const carrierOf = (phone: string): Carrier | null => (isValidPhone(phone) ? (BY_PREFIX.get(normalizePhone(phone).slice(0, 3)) ?? null) : null);

/** The carrier a SIM's name points to ("CELLCARD", "Smart 4G"), or null when it names none of them. */
export function carrierFromName(name: string | null | undefined): Carrier | null {
  const n = (name ?? '').toLowerCase();
  return CARRIERS.find((c) => n.includes(c)) ?? null;
}

export const carrierLabel = (c: Carrier | null) => (c ? CARRIER_LABEL[c] : 'Unknown');

/** One SIM in the gateway phone, as the last scan found it (Phase 12). */
export interface SimInfo {
  simNumber: number;
  carrierName: string | null;
  /** The SIM's own number, as the phone reports it or as staff typed it. */
  phoneNumber: string | null;
  /** The carrier the scan suggests, from the carrier name, else from the SIM's own number. */
  suggested: Carrier | null;
  /** The confirmed carrier, or null while this SIM waits for a staff member to confirm it. */
  carrier: Carrier | null;
}

/** The SIM slot for each carrier with a confirmed SIM in the phone; the first slot wins if two SIMs share a carrier. */
export function simByCarrier(sims: SimInfo[]) {
  const slot = new Map<Carrier, number>();
  for (const s of [...sims].sort((a, b) => a.simNumber - b.simNumber)) if (s.carrier && !slot.has(s.carrier)) slot.set(s.carrier, s.simNumber);
  return slot;
}

/**
 * Splits customers into those the gateway phone texts (their carrier has a confirmed SIM in it now) and those staff
 * contact by hand (owner, 2026-10-23: no fallback SIM). Each keeps its carrier and SIM.
 */
export function splitBySim<T extends { phone: string }>(items: T[], sims: SimInfo[]) {
  const slot = simByCarrier(sims);
  const auto: (T & { carrier: Carrier; sim: number })[] = [];
  const byHand: (T & { carrier: Carrier | null })[] = [];
  for (const i of items) {
    const carrier = carrierOf(i.phone);
    const sim = carrier ? slot.get(carrier) : undefined;
    if (carrier && sim) auto.push({ ...i, carrier, sim });
    else byHand.push({ ...i, carrier });
  }
  return { auto, byHand };
}

/** Customers per carrier, most first (unknown prefixes last), each with the SIM that texts them or null for by hand. */
export function carrierCounts(items: { phone: string }[], sims: SimInfo[]) {
  const slot = simByCarrier(sims);
  const counts = new Map<Carrier | null, number>();
  for (const i of items) {
    const c = carrierOf(i.phone);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts]
    .map(([carrier, count]) => ({ carrier, count, sim: carrier ? (slot.get(carrier) ?? null) : null }))
    .sort((a, b) => (a.carrier === null ? 1 : 0) - (b.carrier === null ? 1 : 0) || b.count - a.count);
}
