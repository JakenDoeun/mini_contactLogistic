// Parcels come from the branch database (Phase 6). The contact log (SMS, calls, notes) is still a mock until Phase 9.
// shortcut: contact events live in module memory, so they survive page changes but reset on reload; Phase 9 replaces them.
import { useSyncExternalStore } from 'react';
import { listParcels, saveParcelPhone } from '@/lib/import-api';
import { normalizePhone, type Channel, type ContactEvent, type Outcome, type Parcel, type SmsStatus } from '@/lib/parcel-logic';

export interface ParcelData {
  parcels: Parcel[];
  events: ContactEvent[];
  /** The latest "Notify today's customers" run, so its progress can be followed until staff dismiss it. */
  batch: SmsBatch | null;
}

export interface SmsBatch {
  eventIds: string[];
  startedAt: string;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let data: ParcelData | null = null;
let error: string | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function commit(next: ParcelData) {
  data = next;
  notify();
}

// Each page that opens reloads the list, so parcels confirmed on Import Arrivals show without a page reload.
export function reloadParcels() {
  listParcels().then(
    (parcels) => {
      error = null;
      commit({ events: [], batch: null, ...data, parcels });
    },
    (e: Error) => {
      error = e.message;
      notify();
    },
  );
}

function subscribe(l: () => void) {
  if (listeners.size === 0) reloadParcels();
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Live parcel data; null until the first load finishes. */
export const useParcelData = () => useSyncExternalStore(subscribe, () => data, () => null);

/** Why the parcel list could not be loaded, or null. */
export const useParcelError = () => useSyncExternalStore(subscribe, () => error, () => null);

/** Saves a staff phone edit on the server, then shows it. Throws with a sentence staff can act on. */
export async function updatePhone(parcel: Parcel, phone: string) {
  await saveParcelPhone(parcel.id, phone.trim());
  if (data) commit({ ...data, parcels: data.parcels.map((p) => (p.id === parcel.id ? { ...p, phone: phone.trim() } : p)) });
}

function append(event: Omit<ContactEvent, 'id' | 'at'>) {
  const full = { ...event, id: crypto.randomUUID(), at: new Date().toISOString() };
  commit({ ...data!, events: [...data!.events, full] });
  return full;
}

function setSms(id: string, smsStatus: SmsStatus, result: string) {
  if (data) commit({ ...data, events: data.events.map((e) => (e.id === id ? { ...e, smsStatus, result } : e)) });
}

export function recordOutcome(phone: string, codes: string[], channel: Channel, outcome: Outcome, note?: string) {
  return append({ channel, phone: normalizePhone(phone), parcelCodes: codes, outcome, result: note });
}

// Simulated gateway answers, so every path can be seen: this number is always rejected, this one never confirms.
const REJECTED = new Set(['0965552041', '016902377']);
const NO_REPORT = new Set(['0978801123']);

function simulatedResult(phone: string): [SmsStatus, string] {
  if (REJECTED.has(phone)) return ['failed', 'Gateway rejected the number (simulated). Check the phone number, or call instead.'];
  if (NO_REPORT.has(phone)) return ['unconfirmed', 'Sent, but no delivery report came back (simulated). It may or may not have arrived.'];
  return ['sent', 'Accepted by the gateway (simulated). No delivery report yet.'];
}

// One worker hands SMS to the gateway one at a time, in the order they were queued.
// shortcut: the queue lives in this tab's memory; the backend runs the real gateway queue.
const pending: string[] = [];
let working = false;

function enqueue(ids: string[]) {
  pending.push(...ids);
  if (!working) void work();
}

async function work() {
  working = true;
  while (pending.length) {
    const id = pending.shift()!;
    setSms(id, 'sending', 'Handing over to the gateway (simulated).');
    await wait(1100);
    const event = data?.events.find((e) => e.id === id);
    if (event) setSms(id, ...simulatedResult(event.phone));
    await wait(300);
  }
  working = false;
}

function appendQueued(phone: string, codes: string[], message: string) {
  return append({ channel: 'sms', phone: normalizePhone(phone), parcelCodes: codes, message, smsStatus: 'queued', result: 'Waiting for the gateway.' });
}

/**
 * Queues one SMS covering every listed parcel. Simulated: it walks to "Sent" (accepted by a gateway), "Failed"
 * or "Unconfirmed" and stops there. Nothing claims delivery, because only a real delivery report could.
 */
export function queueSms(phone: string, codes: string[], message: string) {
  const event = appendQueued(phone, codes, message);
  enqueue([event.id]);
  return event;
}

/** Queues a whole run at once; the worker still sends them one by one. */
export function queueBatch(items: { phone: string; codes: string[]; message: string }[]) {
  const ids = items.map((i) => appendQueued(i.phone, i.codes, i.message).id);
  commit({ ...data!, batch: { eventIds: ids, startedAt: new Date().toISOString() } });
  enqueue(ids);
}

export function dismissBatch() {
  if (data) commit({ ...data, batch: null });
}
