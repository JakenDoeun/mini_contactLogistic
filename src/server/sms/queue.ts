// The SMS records (plan Revision 4, Phase 9): one message per phone line per arrival day with one ID and one status
// shared by its parcels; a retry after Failed is the same message with a new attempt; calls and Telegram are history
// entries, and a call that reached the customer stops the SMS for those parcels (owner, 2026-10-20). Staff save here;
// the worker (worker.ts) hands messages to the phone one at a time.
import crypto from 'node:crypto';
import { carrierLabel, carrierOf } from '../../lib/carriers.ts';
import { isValidPhone, normalizePhone, type Channel, type ContactEvent, type Outcome, type SmsStatus } from '../../lib/parcel-logic.ts';
import { writeAudit } from '../db/audit.ts';
import type { Db } from '../db/connection.ts';
import { readSetting, writeSetting } from '../db/settings.ts';
import { cambodiaDate, nowIso } from '../db/values.ts';
import { simState } from '../gateway/sims.ts';
import { readGatewayConfig } from '../gateway/smsgate.ts';

export type AttemptState = 'queued' | 'submitting' | 'submitted' | 'sent' | 'delivered' | 'failed' | 'unconfirmed' | 'cancelled';
/** Waiting for or at the phone: a second message for these parcels would duplicate it. */
export const IN_FLIGHT: AttemptState[] = ['queued', 'submitting', 'submitted'];
/** Told already, or maybe told: a new first message would duplicate it. */
const MESSAGED: AttemptState[] = ['sent', 'delivered', 'unconfirmed'];
export const MAX_TEXT = 1000;

export type QueueError = { ok: false; error: string; message: string };
const refuse = (error: string, message: string): QueueError => ({ ok: false, error, message });

// After a restore, messages sent after the copy are missing here, so their parcels look Not sent. Nothing is sent until
// staff check the gateway phone and confirm (owner, 2026-10-20).
export const RESTORE_HOLD = 'sms.restore_hold';
export const restoreHold = (db: Db) => (readSetting(db, RESTORE_HOLD) as { copyAt: string } | undefined) ?? null;
const held = () => refuse('restore_hold', 'Sending is on hold after a restore. Check the gateway phone on the Notifications page first.');

// Saved by the worker while a waiting message cannot reach the gateway phone, so the pages can say why nothing goes out.
export const PHONE_AWAY = 'sms.phone_away';
// Saved by the worker while a SIM that messages wait for is not in the phone (Phase 12).
export const SIM_MISSING = 'sms.sim_missing';
// Saved by the worker when one SIM failed twice in a row and it paused the run (Phase 12); cleared on Resume.
export const SIM_PAUSE = 'sms.sim_pause';

/** The SIM slot for a customer's number, or null when their carrier has no confirmed SIM in the phone (Phase 12). */
export type Route = (phone: string) => number | null;
const noSim = (phone: string) =>
  refuse('no_sim', `No ${carrierLabel(carrierOf(phone))} SIM is set up in the gateway phone right now. Contact this customer by hand.`);

/**
 * Whether a gateway phone is set up, since when it has not answered (null when it answers), its SIMs as last scanned,
 * the SIMs waiting messages miss, and the SIM whose failures paused the run (Phase 12).
 */
export function gatewayState(db: Db, dataDir: string) {
  let setUp: boolean;
  try {
    setUp = !!readGatewayConfig(dataDir);
  } catch {
    setUp = false; // an incomplete gateway.json cannot be used either
  }
  const away = readSetting(db, PHONE_AWAY) as { since: string } | undefined;
  const missing = readSetting(db, SIM_MISSING) as { sims: number[] } | undefined;
  const pause = readSetting(db, SIM_PAUSE) as { sim: number } | undefined;
  return { setUp, awaySince: away?.since ?? null, sims: simState(db).sims, simMissing: missing?.sims ?? [], simPause: pause?.sim ?? null };
}

/** Called by npm run restore: holds every SMS until staff confirm they checked the phone. */
export const holdAfterRestore = (db: Db, copyAt: Date, at = nowIso()) => writeSetting(db, RESTORE_HOLD, { copyAt: copyAt.toISOString() }, null, at);

/**
 * Staff checked the gateway phone after a restore. Each line they saw an SMS for is saved as Sent (so it is never
 * messaged twice), then the hold is lifted, in one transaction.
 */
export function releaseRestoreHold(db: Db, seen: { phone: string; parcelIds: number[] }[], userId: number | null, at = nowIso()) {
  return db
    .transaction(() => {
      if (!restoreHold(db)) return refuse('not_held', 'Sending is not on hold.');
      const lines = seen.map((line) => lineParcels(db, line.phone, line.parcelIds));
      const bad = lines.find((l) => !l.ok);
      if (bad) return bad; // before any write, so a refusal leaves nothing half saved
      for (const line of lines as { ok: true; rows: ParcelRow[] }[]) {
        const saved = insertMessage(db, line.rows, 'An SMS seen on the gateway phone after a restore.', 'resend', null, userId, at);
        db.prepare(`UPDATE sms_attempts SET state = 'sent', error_code = 'seen_on_phone', submitted_at = ?, sent_at = ? WHERE id = ?`).run(at, at, saved.attemptId);
      }
      db.prepare('DELETE FROM settings WHERE key = ?').run(RESTORE_HOLD);
      writeAudit(db, { action: 'sms.hold_released', entity: 'notification', entityIds: [], outcome: 'ok', userId, at, detail: { count: seen.length } });
      return { ok: true as const };
    })
    .immediate();
}

/** Each parcel's latest attempt state (null when never messaged) and whether a call reached the customer. */
function parcelState(db: Db, parcelId: number) {
  const latest = db
    .prepare(
      `SELECT a.state FROM notification_parcels np
       JOIN sms_attempts a ON a.notification_id = np.notification_id
       WHERE np.parcel_id = ? ORDER BY a.queued_at DESC, a.attempt_no DESC LIMIT 1`,
    )
    .get(parcelId) as { state: AttemptState } | undefined;
  const busy = db
    .prepare(
      `SELECT 1 FROM notification_parcels np
       JOIN sms_attempts a ON a.notification_id = np.notification_id
       WHERE np.parcel_id = ? AND a.state IN ('queued', 'submitting', 'submitted') LIMIT 1`,
    )
    .get(parcelId);
  const reached = db
    .prepare(
      `SELECT 1 FROM contact_attempt_parcels cp JOIN contact_attempts c ON c.id = cp.contact_attempt_id
       WHERE cp.parcel_id = ? AND c.outcome = 'reached' LIMIT 1`,
    )
    .get(parcelId);
  return { latest: latest?.state ?? null, busy: !!busy, reached: !!reached };
}

interface ParcelRow {
  id: number;
  phone_normalized: string | null;
  arrival_date: string;
}

/** The parcels, all on this phone line and one arrival day, or a refusal staff can act on. */
function lineParcels(db: Db, phone: string, parcelIds: number[]): { ok: true; rows: ParcelRow[] } | QueueError {
  if (!isValidPhone(phone)) return refuse('invalid_phone', 'Add a full phone number before sending.');
  const ids = [...new Set(parcelIds)];
  if (ids.length === 0 || ids.length > 200 || !ids.every((n) => Number.isSafeInteger(n) && n > 0)) return refuse('invalid_request', 'No parcels to message.');
  const rows = ids.map((id) => db.prepare('SELECT id, phone_normalized, arrival_date FROM parcels WHERE id = ?').get(id) as ParcelRow | undefined);
  if (rows.some((r) => !r)) return refuse('not_found', 'A parcel in this message no longer exists. Reload the page.');
  const found = rows as ParcelRow[];
  if (found.some((r) => r.phone_normalized !== normalizePhone(phone))) {
    return refuse('phone_changed', 'A parcel in this message is on another number now. Reload the page.');
  }
  if (new Set(found.map((r) => r.arrival_date)).size > 1) return refuse('mixed_days', 'One SMS covers one arrival day only.');
  return { ok: true, rows: found };
}

function insertMessage(db: Db, rows: ParcelRow[], text: string, reason: 'initial' | 'resend', batchId: number | null, userId: number | null, at: string, sim: number | null = null) {
  const n = db
    .prepare(
      `INSERT INTO notifications (phone_normalized, arrival_date, message_text, reason, batch_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(rows[0].phone_normalized, rows[0].arrival_date, text, reason, batchId, userId, at) as { id: number };
  const link = db.prepare('INSERT INTO notification_parcels (notification_id, parcel_id) VALUES (?, ?)');
  for (const r of rows) link.run(n.id, r.id);
  const attemptId = insertAttempt(db, n.id, 1, at, sim);
  return { notificationId: n.id, attemptId };
}

function insertAttempt(db: Db, notificationId: number, attemptNo: number, at: string, sim: number | null = null) {
  const id = crypto.randomUUID(); // also the message ID on the phone, so a repeated hand-over is refused there
  db.prepare(`INSERT INTO sms_attempts (id, notification_id, attempt_no, state, queued_at, sim_number) VALUES (?, ?, ?, 'queued', ?, ?)`).run(
    id,
    notificationId,
    attemptNo,
    at,
    sim,
  );
  return id;
}

function cleanText(text: unknown): string | QueueError {
  if (typeof text !== 'string' || !text.trim()) return refuse('invalid_request', 'Write the message before sending.');
  if (text.length > MAX_TEXT) return refuse('too_long', `Keep the message under ${MAX_TEXT} characters.`);
  return text.trim();
}

export interface QueueInput {
  phone: string;
  parcelIds: number[];
  text: string;
  /** Staff chose to message parcels that were messaged before ("Send again"). */
  again?: boolean;
  /** The message a retry belongs to: unchanged text and parcels become its next attempt. */
  retryOf?: number;
}

/**
 * Saves one SMS for a phone line, checked inside one BEGIN IMMEDIATE transaction against the database as it is now.
 * With `route`, the SMS goes from its carrier's SIM, and a carrier with no SIM is refused (Phase 12).
 */
export function queueMessage(db: Db, input: QueueInput, userId: number | null, at = nowIso(), route?: Route) {
  const text = cleanText(input.text);
  if (typeof text !== 'string') return text;
  const sim = route ? route(input.phone) : null;
  if (route && sim === null && isValidPhone(input.phone)) return noSim(input.phone);
  return db
    .transaction(() => {
      if (restoreHold(db)) return held();
      const line = lineParcels(db, input.phone, input.parcelIds);
      if (!line.ok) return line;
      const states = line.rows.map((r) => parcelState(db, r.id));
      if (states.some((s) => s.busy)) return refuse('in_flight', 'An SMS for these parcels is already waiting at the gateway.');
      if (!input.again && input.retryOf === undefined && states.some((s) => (s.latest && MESSAGED.includes(s.latest)) || s.reached)) {
        return refuse('already_messaged', 'Some of these parcels were messaged or reached already. Reload the page.');
      }

      let saved: { notificationId: number; attemptId: string } | null = null;
      if (input.retryOf !== undefined) {
        const prev = db.prepare('SELECT id, message_text FROM notifications WHERE id = ?').get(input.retryOf) as { id: number; message_text: string } | undefined;
        if (!prev) return refuse('not_found', 'This message no longer exists. Reload the page.');
        const last = db.prepare('SELECT attempt_no, state FROM sms_attempts WHERE notification_id = ? ORDER BY attempt_no DESC LIMIT 1').get(prev.id) as {
          attempt_no: number;
          state: AttemptState;
        };
        if (last.state !== 'failed' && last.state !== 'unconfirmed') return refuse('not_retryable', 'This message did not fail, so there is nothing to retry.');
        const linked = (db.prepare('SELECT parcel_id FROM notification_parcels WHERE notification_id = ? ORDER BY parcel_id').all(prev.id) as { parcel_id: number }[])
          .map((r) => r.parcel_id)
          .join(',');
        const same = prev.message_text === text && linked === line.rows.map((r) => r.id).sort((a, b) => a - b).join(',');
        if (same) saved = { notificationId: prev.id, attemptId: insertAttempt(db, prev.id, last.attempt_no + 1, at, sim) };
      }
      saved ??= insertMessage(db, line.rows, text, input.again || input.retryOf !== undefined ? 'resend' : 'initial', null, userId, at, sim);
      writeAudit(db, {
        action: 'notification.queued', entity: 'notification', entityIds: [saved.notificationId], outcome: 'ok', userId, at,
        detail: { count: line.rows.length, source: input.retryOf !== undefined ? 'retry' : input.again ? 'again' : 'single' },
      });
      return { ok: true as const, ...saved };
    })
    .immediate();
}

export interface NotifyItem {
  phone: string;
  parcelIds: number[];
  text: string;
}

/**
 * "Notify today's customers", or one earlier day's customers: one batch for one arrival day, never mixed. Each item is
 * one SMS for one phone line, re-checked here; a line whose parcels were messaged, reached or moved meanwhile is
 * skipped, never sent twice. An earlier day needs staff to confirm they checked those customers still need it (owner,
 * 2026-10-20). The same request key a second time (a double click, a retried request) creates nothing. With `route`,
 * each SMS goes from its carrier's SIM, and a line whose carrier has no SIM is left for staff to contact by hand.
 */
export function notifyDay(
  db: Db,
  input: { requestKey: string; day: string; items: NotifyItem[]; checked?: boolean },
  userId: number | null,
  now = new Date(),
  route?: Route,
) {
  const { requestKey, day, items } = input;
  if (!/^[0-9a-f-]{36}$/.test(requestKey)) return refuse('invalid_request', 'The request had no key. Reload the page.');
  if (items.length === 0 || items.length > 500) return refuse('invalid_request', 'Nothing to send.');
  const at = now.toISOString();
  const today = cambodiaDate(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today) return refuse('invalid_request', 'Choose an arrival day up to today.');
  if (day !== today && input.checked !== true) {
    return refuse('not_checked', 'These parcels arrived before today. Confirm you checked these customers still need the message.');
  }
  return db
    .transaction(() => {
      const existing = db.prepare('SELECT id FROM send_batches WHERE request_key = ?').get(requestKey) as { id: number } | undefined;
      if (existing) return { ok: true as const, batchId: existing.id, queued: 0, skipped: 0, byHand: 0, repeated: true };
      if (restoreHold(db)) return held();
      if (db.prepare(`SELECT 1 FROM send_batches WHERE status IN ('running', 'paused')`).get()) {
        return refuse('batch_running', 'Another batch is still sending or paused. Let it finish or stop it first.');
      }

      const accepted: { rows: ParcelRow[]; text: string; sim: number | null }[] = [];
      let skipped = 0;
      let byHand = 0;
      for (const item of items) {
        const sim = route ? route(item.phone) : null;
        if (route && sim === null) {
          byHand++;
          continue;
        }
        const text = cleanText(item.text);
        const line = typeof text === 'string' ? lineParcels(db, item.phone, item.parcelIds) : text;
        const usable =
          typeof text === 'string' &&
          line.ok &&
          line.rows[0].arrival_date === day &&
          line.rows.every((r) => {
            const s = parcelState(db, r.id);
            return !s.busy && !s.reached && !(s.latest && MESSAGED.includes(s.latest));
          }) &&
          !accepted.some((a) => a.rows[0].phone_normalized === line.rows[0].phone_normalized);
        if (usable) accepted.push({ rows: line.rows, text, sim });
        else skipped++;
      }
      if (accepted.length === 0 && byHand > 0 && skipped === 0) {
        return refuse('no_sim', 'None of these customers has a carrier with a SIM set up in the gateway phone. Contact them by hand.');
      }
      if (accepted.length === 0) return refuse('nothing_to_send', 'Every customer on the list was messaged or reached already.');

      const parcels = accepted.reduce((n, a) => n + a.rows.length, 0);
      const batch = db
        .prepare(
          `INSERT INTO send_batches (request_key, arrival_date, planned_messages, planned_parcels, status, created_by, created_at)
           VALUES (?, ?, ?, ?, 'running', ?, ?) RETURNING id`,
        )
        .get(requestKey, day, accepted.length, parcels, userId, at) as { id: number };
      for (const a of accepted) insertMessage(db, a.rows, a.text, 'initial', batch.id, userId, at, a.sim);
      writeAudit(db, {
        action: 'send_batch.started', entity: 'send_batch', entityIds: [batch.id], outcome: 'ok', userId, at,
        detail: { counts: { messages: accepted.length, parcels, skipped, by_hand: byHand }, arrival_dates: [day] },
      });
      return { ok: true as const, batchId: batch.id, queued: accepted.length, skipped, byHand, repeated: false };
    })
    .immediate();
}

/** Pause, resume or stop a batch. Stopping cancels its messages still waiting their turn; sent ones stay as they are. */
export function controlBatch(db: Db, batchId: number, action: 'pause' | 'resume' | 'stop', userId: number | null, at = nowIso()) {
  return db
    .transaction(() => {
      const batch = db.prepare('SELECT status FROM send_batches WHERE id = ?').get(batchId) as { status: string } | undefined;
      if (!batch) return refuse('not_found', 'This batch no longer exists. Reload the page.');
      if (batch.status === 'stopped' || batch.status === 'done') return refuse('finished', 'This batch has already finished.');
      const next = action === 'pause' ? 'paused' : action === 'resume' ? 'running' : 'stopped';
      db.prepare('UPDATE send_batches SET status = ? WHERE id = ?').run(next, batchId);
      if (next !== 'paused') db.prepare('DELETE FROM settings WHERE key = ?').run(SIM_PAUSE); // staff checked the SIM
      if (next === 'stopped') {
        db.prepare(
          `UPDATE sms_attempts SET state = 'cancelled', error_code = 'stopped', failed_at = ?
           WHERE state = 'queued' AND notification_id IN (SELECT id FROM notifications WHERE batch_id = ?)`,
        ).run(at, batchId);
      }
      writeAudit(db, { action: 'send_batch.changed', entity: 'send_batch', entityIds: [batchId], outcome: 'ok', userId, at, detail: { status_from: batch.status, status_to: next } });
      return { ok: true as const, status: next };
    })
    .immediate();
}

/**
 * Staff chose to contact by hand the customers whose SMS wait for a SIM that is not in the phone (Phase 12): those SMS
 * are cancelled, never sent, so the customers show again as not notified, on Contact by hand.
 */
export function releaseSimMessages(db: Db, sim: number, userId: number | null, at = nowIso()) {
  return db
    .transaction(() => {
      const r = db.prepare(`UPDATE sms_attempts SET state = 'cancelled', error_code = 'sim_missing', failed_at = ? WHERE state = 'queued' AND sim_number = ?`).run(at, sim);
      writeAudit(db, { action: 'sms.sim_released', entity: 'sms_attempt', entityIds: [sim], outcome: 'ok', userId, at, detail: { count: r.changes } });
      return r.changes;
    })
    .immediate();
}

const OUTCOME_IN: Record<Outcome, string> = { answered: 'reached', 'no-answer': 'no_answer', messaged: 'messaged' };
const OUTCOME_OUT: Record<string, Outcome> = { reached: 'answered', no_answer: 'no-answer', messaged: 'messaged' };

/** A call, Telegram message or SMS from another phone that staff made outside the app, for every parcel on the line. */
export function recordContact(db: Db, input: { phone: string; parcelIds: number[]; channel: unknown; outcome: unknown }, userId: number | null, at = nowIso()) {
  const valid =
    (input.channel === 'call' && (input.outcome === 'answered' || input.outcome === 'no-answer')) ||
    ((input.channel === 'telegram' || input.channel === 'other') && input.outcome === 'messaged');
  if (!valid) return refuse('invalid_request', 'Choose what happened.');
  return db
    .transaction(() => {
      const line = lineParcels(db, input.phone, input.parcelIds);
      if (!line.ok) return line;
      const c = db
        .prepare(`INSERT INTO contact_attempts (channel, outcome, phone_normalized, created_by, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id`)
        .get(input.channel, OUTCOME_IN[input.outcome as Outcome], line.rows[0].phone_normalized, userId, at) as { id: number };
      const link = db.prepare('INSERT INTO contact_attempt_parcels (contact_attempt_id, parcel_id) VALUES (?, ?)');
      for (const r of line.rows) link.run(c.id, r.id);
      writeAudit(db, { action: 'contact.recorded', entity: 'contact_attempt', entityIds: [c.id], outcome: 'ok', userId, at, detail: { count: line.rows.length } });
      return { ok: true as const, id: c.id };
    })
    .immediate();
}

const STATUS: Record<AttemptState, SmsStatus> = {
  queued: 'queued',
  submitting: 'sending',
  submitted: 'sending',
  sent: 'sent',
  delivered: 'delivered',
  failed: 'failed',
  unconfirmed: 'unconfirmed',
  cancelled: 'not-sent',
};

/** What staff read next to a message's status. */
function resultText(a: { state: AttemptState; gateway_state: string | null; error_code: string | null; error_detail: string | null }) {
  switch (a.state) {
    case 'queued':
      return 'Waiting for its turn at the gateway phone.';
    case 'submitting':
      return 'Handing over to the gateway phone.';
    case 'submitted':
      return a.gateway_state === 'Processed' ? 'The phone is sending it.' : 'The phone accepted it and will send it next.';
    case 'sent':
      return a.error_code === 'seen_on_phone' ? 'Sent: staff saw it on the gateway phone after a restore.' : 'Sent by the phone. No delivery report yet.';
    case 'delivered':
      return 'Delivered: the carrier confirmed it reached the customer.';
    case 'failed':
      return a.error_code === 'auth'
        ? 'The gateway refused its password. Sending is paused until an admin fixes it.'
        : `The phone could not send it${a.error_detail ? `: ${a.error_detail}` : '.'} Check the number, or call instead.`;
    case 'unconfirmed':
      return a.error_code === 'missing_on_phone'
        ? 'Check phone: the gateway phone has no record of it any more. It may or may not have been sent.'
        : 'Check phone: the gateway phone could not be asked whether it was sent. It may already have reached the customer.';
    case 'cancelled':
      return a.error_code === 'stopped'
        ? 'Not sent: the batch was stopped.'
        : a.error_code === 'reached'
          ? 'Not sent: staff reached the customer by phone first.'
          : a.error_code === 'sim_missing'
            ? 'Not sent: its SIM was not in the gateway phone, so staff contact this customer by hand.'
          : 'Not sent: the computer stopped before the phone got it.';
  }
}

/** The contact log in the shape the pages use: each message's latest attempt, then calls and Telegram. */
export function listContactEvents(db: Db): ContactEvent[] {
  const codesOf = (sql: string, id: number) => (db.prepare(sql).all(id) as { code: string }[]).map((r) => r.code);
  const messages = db
    .prepare(
      `SELECT n.id, n.phone_normalized AS phone, n.message_text, a.state, a.gateway_state, a.error_code, a.error_detail, a.queued_at, a.sim_number
       FROM notifications n
       JOIN sms_attempts a ON a.notification_id = n.id
        AND a.attempt_no = (SELECT max(attempt_no) FROM sms_attempts WHERE notification_id = n.id)`,
    )
    .all() as {
    id: number;
    phone: string;
    message_text: string;
    state: AttemptState;
    gateway_state: string | null;
    error_code: string | null;
    error_detail: string | null;
    queued_at: string;
    sim_number: number | null;
  }[];
  const contacts = db.prepare('SELECT id, channel, outcome, phone_normalized AS phone, created_at FROM contact_attempts WHERE outcome IN (?, ?, ?)').all('reached', 'no_answer', 'messaged') as {
    id: number;
    channel: Channel;
    outcome: string;
    phone: string;
    created_at: string;
  }[];
  const smsCodes = 'SELECT p.tracking_code AS code FROM notification_parcels np JOIN parcels p ON p.id = np.parcel_id WHERE np.notification_id = ? ORDER BY p.id';
  const contactCodes = 'SELECT p.tracking_code AS code FROM contact_attempt_parcels cp JOIN parcels p ON p.id = cp.parcel_id WHERE cp.contact_attempt_id = ? ORDER BY p.id';
  return [
    ...messages.map((m) => ({
      id: `sms-${m.id}`,
      at: m.queued_at,
      channel: 'sms' as const,
      phone: m.phone,
      parcelCodes: codesOf(smsCodes, m.id),
      smsStatus: STATUS[m.state],
      message: m.message_text,
      result: resultText(m),
      sim: m.sim_number,
    })),
    ...contacts.map((c) => ({
      id: `contact-${c.id}`,
      at: c.created_at,
      channel: c.channel,
      phone: c.phone,
      parcelCodes: codesOf(contactCodes, c.id),
      outcome: OUTCOME_OUT[c.outcome],
    })),
  ];
}

/** The latest batch started today (for today's or an earlier day's arrivals), for the Notifications page's progress line. */
export function latestBatch(db: Db, now = new Date()) {
  const b = db
    .prepare(`SELECT id, status, created_at, arrival_date FROM send_batches WHERE date(created_at, '+7 hours') = ? ORDER BY id DESC LIMIT 1`)
    .get(cambodiaDate(now)) as { id: number; status: string; created_at: string; arrival_date: string } | undefined;
  if (!b) return null;
  const ids = db.prepare('SELECT id FROM notifications WHERE batch_id = ?').all(b.id) as { id: number }[];
  return { id: b.id, day: b.arrival_date, status: b.status as 'running' | 'paused' | 'stopped' | 'done', startedAt: b.created_at, eventIds: ids.map((r) => `sms-${r.id}`) };
}
