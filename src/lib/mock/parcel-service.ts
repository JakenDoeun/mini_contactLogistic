// Mock parcel database and contact log. Swapping these bodies for API calls leaves the components untouched.
// shortcut: data lives in module memory, so it survives page changes but resets on reload; the backend replaces it.
import { useSyncExternalStore } from 'react';
import { addNewParcels, normalizePhone, type Channel, type ContactEvent, type Outcome, type Parcel, type SmsStatus } from '@/lib/parcel-logic';

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

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Each line exercises a rule: name variants on one phone, same name on two phones, a failed SMS
// followed by a reached call, a combined SMS plus a later arrival, and repeated missed calls.
const SEED: [code: string, recipient: string, phone: string, importedHoursAgo: number][] = [
  ['CB4810276635', 'Sokha Chan', '+855 12 345 678', 1.5],
  ['CB2291048871', 'Chan Sokha', '012-345-678', 1.5],
  ['CB7730192245', 'Sokha C.', '012345678', 26],
  ['CB5528814023', 'Dara Kim', '096 555 2041', 26],
  ['CB9014425560', 'Dara Kim', '097 880 1123', 1.5],
  ['CB3365701198', 'Srey Pich Lim', '088 412 7730', 50],
  ['CB6602917734', 'Lim Sreypich', '088 412 7730', 50],
  ['CB1187420096', 'Srey Pich Lim', '088 412 7730', 1.5],
  ['CB8843016652', 'Vibol Sok', '010 223 908', 26],
  ['CB4419830027', 'Rachana Heng', '070 556 112', 2.5],
  ['CB2075519384', 'Bopha Ly', '015 774 320', 2.5],
  ['CB6138842210', 'Piseth Ouk', '081 330 5512', 2.5],
  ['CB9952007461', 'Monyrath Seng', '092 618 044', 23],
  ['CB3307716659', 'Kanha Prak', '016 902 377', 1.5],
  ['CB5190386627', 'Theary Nhem', '077 245 860', 1.5],
  ['CB7461120983', 'Sopheak Tan', '085 119 004', 50],
  ['CB8226650317', 'Sopheak Tan', '085 119 004', 1.5],
  ['CB1950442876', 'Ratanak Pov', '011 650 293', 23],
  ['CB6650213387', 'Sreyleak Nov', '', 2.5], // the export left the phone blank
];

// One sample import per batch time; the 23-hour batch was a manual CSV upload.
function batchFile(at: Date, h: number) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  return h === 23 ? `arrivals_late_${day}.csv` : `arrivals_export_${day}_${pad(at.getHours())}${pad(at.getMinutes())}.xlsx`;
}

function seed(): ParcelData {
  const parcels = SEED.map(([code, recipient, phone, h]) => {
    const at = new Date(Date.now() - h * 3600_000);
    return { code, recipient, phone, importedAt: at.toISOString(), sourceFile: batchFile(at, h) };
  });
  const ev = (h: number, channel: Channel, codes: string[], extra: Partial<ContactEvent>): ContactEvent => ({
    id: `seed-${codes[0]}-${h}-${channel}`,
    at: hoursAgo(h),
    channel,
    phone: normalizePhone(parcels.find((p) => p.code === codes[0])!.phone),
    parcelCodes: codes,
    ...extra,
  });
  const events = [
    ev(25, 'sms', ['CB7730192245'], { smsStatus: 'delivered', result: 'Delivery report received from the gateway.' }),
    ev(25, 'sms', ['CB5528814023'], { smsStatus: 'failed', result: 'Gateway rejected the number.' }),
    ev(24, 'call', ['CB5528814023'], { outcome: 'answered', result: 'Will collect tomorrow.' }),
    ev(48, 'sms', ['CB3365701198', 'CB6602917734'], { smsStatus: 'unconfirmed', result: 'Sent, but no delivery report came back.' }),
    ev(25, 'sms', ['CB8843016652'], { smsStatus: 'sent', result: 'Accepted by the gateway.' }),
    ev(24, 'call', ['CB8843016652'], { outcome: 'no-answer' }),
    ev(4, 'call', ['CB8843016652'], { outcome: 'no-answer' }),
    ev(2, 'sms', ['CB4419830027'], { smsStatus: 'queued', result: 'Waiting for the gateway.' }),
    ev(48, 'sms', ['CB7461120983'], { smsStatus: 'delivered', result: 'Delivery report received from the gateway.' }),
    ev(22, 'telegram', ['CB9952007461'], { outcome: 'messaged', result: 'Message copied to Telegram.' }),
  ];
  return { parcels, events, batch: null };
}

// The sample records every page starts from; the import history is built from the same seed.
let initial: ParcelData | null = null;
export const seedData = () => (initial ??= seed());

let data: ParcelData | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function commit(next: ParcelData) {
  data = next;
  listeners.forEach((l) => l());
}

/** Live parcel data; null until the first load finishes. */
export function useParcelData() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      loading ??= wait(500).then(() => {
        commit(data ?? seedData());
        // A sample SMS left waiting at the gateway goes through the same worker as everything else.
        enqueue(data!.events.filter((e) => e.smsStatus === 'queued').map((e) => e.id));
      });
      return () => listeners.delete(l);
    },
    () => data,
    () => null,
  );
}

/** Every parcel record now, including ones imported this session. */
export const currentParcels = () => (data ?? seedData()).parcels;

/** Saves a confirmed import. Codes already on record are left as they are, phone and history included. */
export function addParcels(incoming: Parcel[]) {
  const base = data ?? seedData();
  commit({ ...base, parcels: addNewParcels(base.parcels, incoming) });
}

export function updatePhone(code: string, phone: string) {
  if (!data) return;
  commit({ ...data, parcels: data.parcels.map((p) => (p.code === code ? { ...p, phone: phone.trim() } : p)) });
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
