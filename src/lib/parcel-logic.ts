// Pure parcel and contact rules. No React, no I/O, so it runs under `node --test`.
// Statuses are derived from the append-only event log, so history is never overwritten.

export type SmsStatus = 'not-sent' | 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'unconfirmed';
export type ContactStatus = 'needs-contact' | 'attempted' | 'follow-up' | 'contacted';
// 'flag' is staff marking parcels for follow-up: an entry in the contact history, not a message or call.
export type Channel = 'sms' | 'call' | 'telegram' | 'flag';
export type Outcome = 'answered' | 'no-answer' | 'messaged' | 'follow-up';

export interface Parcel {
  id: number;
  code: string;
  recipient: string; // display only: names vary between exports
  phone: string; // as saved; compare with normalizePhone
  /** The Arrival Batch Date chosen at import, YYYY-MM-DD: what parcels are grouped by. */
  arrivalDate: string;
  importedAt: string;
  sourceFile: string; // the export file it was imported from
}

export interface ContactEvent {
  id: string;
  at: string;
  channel: Channel;
  phone: string; // normalized, at the time of the event
  parcelCodes: string[]; // every parcel the message or call covered
  smsStatus?: SmsStatus; // sms only
  message?: string; // sms only
  result?: string; // gateway or staff note
  outcome?: Outcome; // call, telegram and flag only
}

export const SMS_STATUSES: SmsStatus[] = ['not-sent', 'queued', 'sending', 'sent', 'delivered', 'failed', 'unconfirmed'];

// Cambodian numbers: "+855 12 345 678", "012-345-678" and "12345678" are the same line.
export function normalizePhone(raw: string) {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('855')) d = d.slice(3);
  if (d && !d.startsWith('0')) d = '0' + d;
  return d;
}

export const isValidPhone = (raw: string) => /^0\d{8,9}$/.test(normalizePhone(raw));

/** A moment's local day as YYYY-MM-DD, comparable with a parcel's arrivalDate. */
export function arrivalDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The grouping key: the normalized number, or null when it is missing or invalid. Null is never grouped. */
export const phoneKey = (raw: string) => (isValidPhone(raw) ? normalizePhone(raw) : null);

export function formatPhone(raw: string) {
  const d = normalizePhone(raw);
  return d.length >= 9 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : raw;
}

export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, '');

const newestFirst = (a: ContactEvent, b: ContactEvent) => b.at.localeCompare(a.at);

export const eventsFor = (code: string, events: ContactEvent[]) => events.filter((e) => e.parcelCodes.includes(code)).sort(newestFirst);

export function smsStatusOf(code: string, events: ContactEvent[]): SmsStatus {
  return eventsFor(code, events).find((e) => e.channel === 'sms')?.smsStatus ?? 'not-sent';
}

// Only staff-recorded outcomes count. A gateway accepting or delivering an SMS is not contact.
// A staff follow-up flag holds until a later "Reached customer" resolves it.
export function contactStatusOf(code: string, events: ContactEvent[]): ContactStatus {
  const manual = eventsFor(code, events).filter((e) => e.outcome); // newest first
  const flag = manual.findIndex((e) => e.outcome === 'follow-up');
  const answer = manual.findIndex((e) => e.outcome === 'answered');
  if (flag !== -1 && (answer === -1 || flag < answer)) return 'follow-up';
  if (answer !== -1) return 'contacted';
  const tries = manual.filter((e) => e.channel !== 'flag').length;
  return tries >= 2 ? 'follow-up' : tries === 1 ? 'attempted' : 'needs-contact';
}

// A phone line's one-glance status is the most urgent of its parcels' own statuses; each parcel keeps its own.
const SMS_URGENCY: SmsStatus[] = ['failed', 'unconfirmed', 'sending', 'queued', 'sent', 'delivered', 'not-sent'];
const CONTACT_URGENCY: ContactStatus[] = ['follow-up', 'attempted', 'needs-contact', 'contacted'];

export function groupSmsStatus(codes: string[], events: ContactEvent[]): SmsStatus {
  const seen = new Set(codes.map((c) => smsStatusOf(c, events)));
  return SMS_URGENCY.find((s) => seen.has(s)) ?? 'not-sent';
}

export function groupContactStatus(codes: string[], events: ContactEvent[]): ContactStatus {
  const seen = new Set(codes.map((c) => contactStatusOf(c, events)));
  return CONTACT_URGENCY.find((s) => seen.has(s)) ?? 'needs-contact';
}

/**
 * Parcels on the same line in the same arrival batch, grouped by phone and never by name. Includes the parcel itself;
 * alone without a valid phone. Earlier batches never join, so a combined SMS only lists that day's arrivals.
 */
export function phoneGroup(parcel: Parcel, parcels: Parcel[]) {
  const key = phoneKey(parcel.phone);
  return parcels.filter((p) => p.code === parcel.code || (key !== null && phoneKey(p.phone) === key && p.arrivalDate === parcel.arrivalDate));
}

export type ParcelFilter = 'all' | 'needs-contact' | 'sms-failed' | 'follow-up' | 'contacted' | 'no-phone';

/** The Parcels page filters. SMS Failed reads the SMS system only; the rest read the contact system only. */
export function inFilter(parcel: Parcel, events: ContactEvent[], filter: ParcelFilter) {
  const code = parcel.code;
  if (filter === 'all') return true;
  if (filter === 'no-phone') return phoneKey(parcel.phone) === null;
  if (filter === 'sms-failed') return smsStatusOf(code, events) === 'failed';
  return contactStatusOf(code, events) === filter;
}

/** Parcels on one phone line in one arrival batch, newest first. Grouped by phone, never by name; the newest name is shown. */
export interface PhoneGroup {
  phone: string;
  /** The arrival batch: the parcels' arrivalDate. */
  day: string;
  recipient: string;
  codes: string[];
}

/** One group per phone line per arrival batch. Parcels without a valid phone each stay alone, with `phone` empty. */
export function groupByPhone(parcels: Parcel[]): PhoneGroup[] {
  const groups = new Map<string, PhoneGroup>();
  for (const p of [...parcels].sort((a, b) => b.importedAt.localeCompare(a.importedAt))) {
    const phone = phoneKey(p.phone);
    const day = p.arrivalDate;
    const key = phone ? `${day}|${phone}` : `no-phone:${p.code}`;
    const g = groups.get(key);
    if (g) g.codes.push(p.code);
    else groups.set(key, { phone: phone ?? '', day, recipient: p.recipient, codes: [p.code] });
  }
  return [...groups.values()];
}

/** Adds newly imported parcels. A code already on record keeps its phone, name and history untouched. */
export function addNewParcels(existing: Parcel[], incoming: Parcel[]) {
  const known = new Set(existing.map((p) => p.code));
  return [...existing, ...incoming.filter((p) => !known.has(p.code) && known.add(p.code))];
}

/** What the card's buttons would do, in one line: "Not messaged yet · one SMS covers all 3 parcels on this number today". */
export function contactLine(toMessage: number, size: number, day: string) {
  const all = `${size} parcels on this number ${day}`;
  if (toMessage === size) return size === 1 ? 'Not messaged yet' : `Not messaged yet · one SMS covers all ${all}`;
  if (toMessage === 0) return size === 1 ? 'Messaged or reached already' : `Messaged or reached already · all ${all}`;
  return `${toMessage} of ${all} not messaged yet`;
}

/** One label for what a message covers, used wherever an SMS is shown. */
export const smsScope = (count: number) => (count === 1 ? 'Individual SMS · 1 parcel' : `Combined SMS · ${count} parcels`);

/** Parcels a new message should cover: a valid phone, never messaged, and not already reached by other means. */
export function eligibleForMessage(group: Parcel[], events: ContactEvent[]) {
  return group.filter(
    (p) => phoneKey(p.phone) !== null && smsStatusOf(p.code, events) === 'not-sent' && contactStatusOf(p.code, events) !== 'contacted',
  );
}

/** An SMS still waiting at the gateway for any of these parcels: sending another would duplicate it. */
export const smsInFlight = (codes: string[], events: ContactEvent[]) =>
  events.some((e) => e.channel === 'sms' && (e.smsStatus === 'queued' || e.smsStatus === 'sending') && e.parcelCodes.some((c) => codes.includes(c)));

/**
 * A failed or unconfirmed SMS can be retried while it is still the latest SMS for one of its parcels
 * (a later one means someone already retried) and nothing for them is waiting at the gateway.
 */
export function canRetry(event: ContactEvent, events: ContactEvent[]) {
  if (event.smsStatus !== 'failed' && event.smsStatus !== 'unconfirmed') return false;
  const latest = event.parcelCodes.some((c) => eventsFor(c, events).find((e) => e.channel === 'sms')?.id === event.id);
  return latest && !smsInFlight(event.parcelCodes, events);
}

export const DEFAULT_TEMPLATES = {
  single: 'Hi {name}, your parcel {codes} has arrived at Campus Branch. Bring your student ID to collect it.',
  combined: 'Hi {name}, {count} new parcels have arrived for you at Campus Branch: {codes}. Bring your student ID to collect them.',
};

// Scope follows the number of parcels: no manual individual/grouped switch.
export function composeMessage(name: string, codes: string[], templates = DEFAULT_TEMPLATES) {
  const first = name.trim().split(/\s+/)[0] || 'there';
  return (codes.length === 1 ? templates.single : templates.combined)
    .replaceAll('{name}', first)
    .replaceAll('{count}', String(codes.length))
    .replaceAll('{codes}', codes.join(', '));
}

// For "Open in Telegram": t.me resolves a number only if the customer allows it, so copying stays the fallback.
export const telegramLink = (raw: string) => `https://t.me/+855${normalizePhone(raw).slice(1)}`;
