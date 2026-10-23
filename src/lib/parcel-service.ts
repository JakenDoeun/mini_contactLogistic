// Parcels and their contact log (SMS, calls, Telegram) from the branch database (Phases 6 and 9). The server queues and
// sends; this only carries staff requests and keeps every open page showing the same list.
import { useSyncExternalStore } from 'react';
import { listParcels, postBatch, postBatchAction, postContact, postRestoreCheck, postSms, saveParcelPhone, type SmsBatch } from '@/lib/import-api';
import type { ContactEvent, Outcome, Parcel } from '@/lib/parcel-logic';

export type { SmsBatch };

export interface ParcelData {
  parcels: Parcel[];
  events: ContactEvent[];
  /** Today's latest "Notify today's customers" run, so its progress can be followed until staff dismiss it. */
  batch: SmsBatch | null;
  /** Set after a restore: nothing is sent until staff check the gateway phone. `copyAt` is when the copy was taken. */
  restoreHold: { copyAt: string } | null;
  /** Whether a gateway phone is set up, and since when it has not answered; queued messages wait for it. */
  gateway: { setUp: boolean; awaySince: string | null };
}

let data: ParcelData | null = null;
let error: string | null = null;
let dismissed: number | null = null; // the batch whose summary staff closed, in this tab
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// Something waiting at the gateway changes within seconds; otherwise a slower check shows other staff's work.
const inFlight = (d: ParcelData) => d.events.some((e) => e.smsStatus === 'queued' || e.smsStatus === 'sending');

/** Loads the list again; each page that opens calls it, so parcels confirmed on Import Arrivals show at once. */
export function reloadParcels() {
  if (timer) clearTimeout(timer);
  timer = null;
  return listParcels().then(
    (r) => {
      error = null;
      data = { parcels: r.parcels, events: r.events, batch: r.batch && r.batch.id !== dismissed ? r.batch : null, restoreHold: r.restoreHold, gateway: r.gateway };
      notify();
      if (listeners.size) timer = setTimeout(reloadParcels, inFlight(data) ? 2_500 : 20_000);
    },
    (e: Error) => {
      error = e.message;
      notify();
      if (listeners.size) timer = setTimeout(reloadParcels, 20_000);
    },
  );
}

function subscribe(l: () => void) {
  if (listeners.size === 0) void reloadParcels();
  listeners.add(l);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer) clearTimeout(timer);
  };
}

/** Live parcel data; null until the first load finishes. */
export const useParcelData = () => useSyncExternalStore(subscribe, () => data, () => null);

/** Why the parcel list could not be loaded, or null. */
export const useParcelError = () => useSyncExternalStore(subscribe, () => error, () => null);

/** Saves a staff phone edit on the server, then shows it. Throws with a sentence staff can act on. */
export async function updatePhone(parcel: Parcel, phone: string) {
  await saveParcelPhone(parcel.id, phone.trim());
  await reloadParcels();
}

const idsOf = (codes: string[]) => codes.map((c) => data?.parcels.find((p) => p.code === c)?.id ?? 0);

/** Records a call or Telegram message made outside the app. Throws with a sentence staff can act on. */
export async function recordOutcome(phone: string, codes: string[], channel: 'call' | 'telegram' | 'other', outcome: Outcome) {
  await postContact({ phone, parcelIds: idsOf(codes), channel, outcome });
  await reloadParcels();
}

/**
 * Queues one SMS covering every listed parcel; the server's worker hands it to the gateway phone. Returns the
 * message's event ID. `retryOf` is the event of a failed or unconfirmed message being sent again.
 */
export async function queueSms(phone: string, codes: string[], text: string, options: { again?: boolean; retryOf?: string } = {}) {
  const retryOf = options.retryOf?.startsWith('sms-') ? Number(options.retryOf.slice(4)) : undefined;
  const r = await postSms({ phone, parcelIds: idsOf(codes), text, again: options.again, retryOf });
  await reloadParcels();
  return `sms-${r.notificationId}`;
}

/**
 * Queues a whole run for one arrival day under one request key, so a second click creates nothing. `checked` is staff
 * confirming an earlier day's customers still need the message.
 */
export async function queueBatch(requestKey: string, day: string, checked: boolean, items: { phone: string; codes: string[]; message: string }[]) {
  const r = await postBatch({ requestKey, day, checked, items: items.map((i) => ({ phone: i.phone, parcelIds: idsOf(i.codes), text: i.message })) });
  dismissed = null;
  await reloadParcels();
  return r;
}

export async function controlBatch(id: number, action: 'pause' | 'resume' | 'stop') {
  await postBatchAction(id, action);
  await reloadParcels();
}

/** After a restore: the lines staff saw an SMS for on the gateway phone are saved as Sent, then sending resumes. */
export async function releaseRestoreHold(seen: { phone: string; codes: string[] }[]) {
  await postRestoreCheck(seen.map((l) => ({ phone: l.phone, parcelIds: idsOf(l.codes) })));
  await reloadParcels();
}

export function dismissBatch() {
  if (!data?.batch) return;
  dismissed = data.batch.id;
  data = { ...data, batch: null };
  notify();
}
