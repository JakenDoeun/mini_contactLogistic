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
