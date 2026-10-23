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
