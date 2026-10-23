// What needs staff attention now, worked out from the parcel records and the contact log.
// Pure: no React, no I/O, so it runs under `node --test`.
import {
  canRetry,
  composeMessage,
  DEFAULT_TEMPLATES,
  eligibleForMessage,
  arrivalDay,
  groupByPhone,
  phoneKey,
  reachedByStaff,
  smsInFlight,
  smsStatusOf,
  type ContactEvent,
  type Parcel,
  type PhoneGroup,
} from './parcel-logic.ts';
import { carrierOf, simByCarrier, splitBySim, type Carrier, type SimInfo } from './carriers.ts';

/** A phone line in the work list. `codes` are the parcels the item is about; `size` counts every parcel on the line. */
export interface WorkGroup extends PhoneGroup {
  size: number;
}

export interface WorkList {
  /** Failed or unconfirmed SMS that can be retried, newest first. */
  retry: ContactEvent[];
  /** Phone lines with parcels nobody has messaged or reached yet, and nothing waiting at the gateway. */
  toMessage: WorkGroup[];
  /** Parcels without a valid phone number: nobody can be messaged until staff add one. */
  noPhone: Parcel[];
  /** SMS waiting at the gateway: no action, but a reason not to send again. */
  inFlight: number;
}

export function workList(parcels: Parcel[], events: ContactEvent[]): WorkList {
  const toMessage = groupByPhone(parcels)
    .filter((g) => g.phone !== '') // no valid phone: listed under noPhone instead
    .map((g) => {
      const group = parcels.filter((p) => phoneKey(p.phone) === g.phone && p.arrivalDate === g.day);
      const eligible = new Set(eligibleForMessage(group, events).map((p) => p.code));
      return { ...g, size: g.codes.length, codes: g.codes.filter((c) => eligible.has(c)) }; // keeps newest first
    })
    .filter((g) => g.codes.length > 0 && !smsInFlight(g.codes, events));
  return {
    retry: events.filter((e) => canRetry(e, events)).sort((a, b) => b.at.localeCompare(a.at)),
    toMessage,
    noPhone: parcels.filter((p) => phoneKey(p.phone) === null).sort((a, b) => b.importedAt.localeCompare(a.importedAt)),
    inFlight: events.filter((e) => e.channel === 'sms' && (e.smsStatus === 'queued' || e.smsStatus === 'sending')).length,
  };
}

/** One prepared SMS: one phone line, every eligible parcel on it, and the message to send. */
export interface NotifyItem {
  phone: string;
  /** The arrival batch the message covers. */
  day: string;
  recipient: string;
  codes: string[];
  message: string;
}

export interface NotifyPlan {
  /** Phone lines with eligible parcels in today's arrival batch. */
  today: NotifyItem[];
  /** The same for earlier batches: sent only one day at a time, after staff review, never with today's. */
  older: NotifyItem[];
  /** Today's parcels that cannot be messaged until staff add a phone number. */
  noPhoneToday: Parcel[];
}

/**
 * "Notify today's customers": one SMS per phone line in today's arrival batch, listing only that batch's eligible
 * codes. Earlier batches never ride along. Already notified, reached, in-flight and phoneless parcels are left out
 * by the work list's own rules.
 */
export function planNotify(parcels: Parcel[], events: ContactEvent[], now: Date, templates = DEFAULT_TEMPLATES): NotifyPlan {
  const today = arrivalDay(now.toISOString());
  const items = workList(parcels, events).toMessage.map((g) => ({
    phone: g.phone,
    day: g.day,
    recipient: g.recipient,
    codes: g.codes,
    message: composeMessage(g.recipient, g.codes, templates),
  }));
  return {
    today: items.filter((i) => i.day === today),
    older: items.filter((i) => i.day !== today),
    noPhoneToday: parcels.filter((p) => p.arrivalDate === today && phoneKey(p.phone) === null),
  };
}

/** Where today's parcels stand, each counted once, most settled first. Feeds the Dashboard's progress bar. */
export interface DayProgress {
  /** SMS accepted or delivered, or the customer reached by staff. */
  done: number;
  /** An SMS waiting at the gateway. */
  sending: number;
  /** The latest SMS failed or was never confirmed. */
  retry: number;
  /** No usable phone number, so nobody can message them. */
  noPhone: number;
  notYet: number;
}

export function dayProgress(parcels: Parcel[], events: ContactEvent[], day: string): DayProgress {
  const out: DayProgress = { done: 0, sending: 0, retry: 0, noPhone: 0, notYet: 0 };
  for (const p of parcels) {
    if (p.arrivalDate !== day) continue;
    const sms = smsStatusOf(p.code, events);
    if (sms === 'sent' || sms === 'delivered' || reachedByStaff(p.code, events)) out.done++;
    else if (sms === 'queued' || sms === 'sending') out.sending++;
    else if (sms === 'failed' || sms === 'unconfirmed') out.retry++;
    else if (phoneKey(p.phone) === null) out.noPhone++;
    else out.notYet++;
  }
  return out;
}

// ---- Contact by hand (Phase 12) -------------------------------------------------------------------------------------

/** Told by staff another way: reached by phone, or messaged on Telegram or from a staff phone. */
const toldByHand = (codes: string[], events: ContactEvent[]) =>
  events.some(
    (e) =>
      ((e.channel === 'call' && e.outcome === 'answered') || ((e.channel === 'telegram' || e.channel === 'other') && e.outcome === 'messaged')) &&
      e.parcelCodes.some((c) => codes.includes(c)),
  );

export interface ByHandLine extends NotifyItem {
  carrier: Carrier | null;
  /** Calls with no answer so far, and the latest one. */
  tries: number;
  lastTry: string | null;
}

export interface ByHandGroup {
  carrier: Carrier | null;
  /** Still to do, in working order: never tried first, then no answer, longest waiting first. */
  lines: ByHandLine[];
  notContacted: number;
  noAnswer: number;
  /** Today's lines on this network that staff already told. */
  done: number;
}

/**
 * Today's customers whose network has no confirmed SIM in the gateway phone, by network: the busiest first, numbers
 * with no known carrier last. Lines told by hand leave the list and count as done.
 */
export function byHandGroups(plan: NotifyPlan, parcels: Parcel[], events: ContactEvent[], sims: SimInfo[], now = new Date()): ByHandGroup[] {
  const tries = (codes: string[]) =>
    events.filter((e) => e.channel === 'call' && e.outcome === 'no-answer' && e.parcelCodes.some((c) => codes.includes(c))).map((e) => e.at).sort();
  const lines: ByHandLine[] = splitBySim(plan.today, sims)
    .byHand.filter((i) => !toldByHand(i.codes, events))
    .map((i) => {
      const t = tries(i.codes);
      return { ...i, tries: t.length, lastTry: t.at(-1) ?? null };
    });

  // Done: today's lines on a network the phone cannot text, already told by hand.
  const today = arrivalDay(now.toISOString());
  const slot = simByCarrier(sims);
  const todayLines = new Map<string, string[]>();
  for (const p of parcels) {
    const k = phoneKey(p.phone);
    if (p.arrivalDate === today && k) todayLines.set(k, [...(todayLines.get(k) ?? []), p.code]);
  }
  const done = new Map<Carrier | null, number>();
  for (const [phone, codes] of todayLines) {
    const c = carrierOf(phone);
    if (!(c && slot.has(c)) && toldByHand(codes, events)) done.set(c, (done.get(c) ?? 0) + 1);
  }

  const carriers = new Set<Carrier | null>([...lines.map((l) => l.carrier), ...done.keys()]);
  return [...carriers]
    .map((carrier) => {
      const mine = lines
        .filter((l) => l.carrier === carrier)
        .sort((a, b) => (a.tries ? 1 : 0) - (b.tries ? 1 : 0) || (a.lastTry ?? '').localeCompare(b.lastTry ?? ''));
      return {
        carrier,
        lines: mine,
        notContacted: mine.filter((l) => !l.tries).length,
        noAnswer: mine.filter((l) => l.tries).length,
        done: done.get(carrier) ?? 0,
      };
    })
    .sort((a, b) => (a.carrier === null ? 1 : 0) - (b.carrier === null ? 1 : 0) || b.lines.length - a.lines.length || b.done - a.done);
}
