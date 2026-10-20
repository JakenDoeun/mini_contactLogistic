// The SMS records (plan Revision 4, Phase 9): one message per phone line per arrival day with one ID and one status
// shared by its parcels; a retry after Failed is the same message with a new attempt; calls and Telegram are history
// entries, and a call that reached the customer stops the SMS for those parcels (owner, 2026-10-20). Staff save here;
// the worker (worker.ts) hands messages to the phone one at a time.
import crypto from 'node:crypto';
import { isValidPhone, normalizePhone, type Channel, type ContactEvent, type Outcome, type SmsStatus } from '../../lib/parcel-logic.ts';
import { writeAudit } from '../db/audit.ts';
import type { Db } from '../db/connection.ts';
import { cambodiaDate, nowIso } from '../db/values.ts';

export type AttemptState = 'queued' | 'submitting' | 'submitted' | 'sent' | 'delivered' | 'failed' | 'unconfirmed' | 'cancelled';
/** Waiting for or at the phone: a second message for these parcels would duplicate it. */
export const IN_FLIGHT: AttemptState[] = ['queued', 'submitting', 'submitted'];
/** Told already, or maybe told: a new first message would duplicate it. */
const MESSAGED: AttemptState[] = ['sent', 'delivered', 'unconfirmed'];
export const MAX_TEXT = 1000;

export type QueueError = { ok: false; error: string; message: string };
const refuse = (error: string, message: string): QueueError => ({ ok: false, error, message });

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

function insertMessage(db: Db, rows: ParcelRow[], text: string, reason: 'initial' | 'resend', batchId: number | null, userId: number | null, at: string) {
  const n = db
    .prepare(
      `INSERT INTO notifications (phone_normalized, arrival_date, message_text, reason, batch_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(rows[0].phone_normalized, rows[0].arrival_date, text, reason, batchId, userId, at) as { id: number };
  const link = db.prepare('INSERT INTO notification_parcels (notification_id, parcel_id) VALUES (?, ?)');
  for (const r of rows) link.run(n.id, r.id);
  const attemptId = insertAttempt(db, n.id, 1, at);
  return { notificationId: n.id, attemptId };
}

function insertAttempt(db: Db, notificationId: number, attemptNo: number, at: string) {
  const id = crypto.randomUUID(); // also the message ID on the phone, so a repeated hand-over is refused there
  db.prepare(`INSERT INTO sms_attempts (id, notification_id, attempt_no, state, queued_at) VALUES (?, ?, ?, 'queued', ?)`).run(id, notificationId, attemptNo, at);
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

/** Saves one SMS for a phone line, checked inside one BEGIN IMMEDIATE transaction against the database as it is now. */
export function queueMessage(db: Db, input: QueueInput, userId: number | null, at = nowIso()) {
  const text = cleanText(input.text);
  if (typeof text !== 'string') return text;
  return db
    .transaction(() => {
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
        if (same) saved = { notificationId: prev.id, attemptId: insertAttempt(db, prev.id, last.attempt_no + 1, at) };
      }
      saved ??= insertMessage(db, line.rows, text, input.again || input.retryOf !== undefined ? 'resend' : 'initial', null, userId, at);
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
 * "Notify today's customers": one batch, each item one SMS for one phone line, today's arrivals only. Items are
 * re-checked here; a line whose parcels were messaged, reached or moved meanwhile is skipped, never sent twice.
 * The same request key a second time (a double click, a retried request) creates nothing.
 */
export function notifyToday(db: Db, requestKey: string, items: NotifyItem[], userId: number | null, now = new Date()) {
  if (!/^[0-9a-f-]{36}$/.test(requestKey)) return refuse('invalid_request', 'The request had no key. Reload the page.');
  if (items.length === 0 || items.length > 500) return refuse('invalid_request', 'Nothing to send.');
  const at = now.toISOString();
  const today = cambodiaDate(now);
  return db
    .transaction(() => {
      const existing = db.prepare('SELECT id FROM send_batches WHERE request_key = ?').get(requestKey) as { id: number } | undefined;
      if (existing) return { ok: true as const, batchId: existing.id, queued: 0, skipped: 0, repeated: true };

      const accepted: { rows: ParcelRow[]; text: string }[] = [];
      let skipped = 0;
      for (const item of items) {
        const text = cleanText(item.text);
        const line = typeof text === 'string' ? lineParcels(db, item.phone, item.parcelIds) : text;
        const usable =
          typeof text === 'string' &&
          line.ok &&
          line.rows[0].arrival_date === today &&
          line.rows.every((r) => {
            const s = parcelState(db, r.id);
            return !s.busy && !s.reached && !(s.latest && MESSAGED.includes(s.latest));
          }) &&
          !accepted.some((a) => a.rows[0].phone_normalized === line.rows[0].phone_normalized);
        if (usable) accepted.push({ rows: line.rows, text });
        else skipped++;
      }
      if (accepted.length === 0) return refuse('nothing_to_send', 'Every customer on the list was messaged or reached already.');

      const parcels = accepted.reduce((n, a) => n + a.rows.length, 0);
      const batch = db
        .prepare(
          `INSERT INTO send_batches (request_key, arrival_date, planned_messages, planned_parcels, status, created_by, created_at)
           VALUES (?, ?, ?, ?, 'running', ?, ?) RETURNING id`,
        )
        .get(requestKey, today, accepted.length, parcels, userId, at) as { id: number };
      for (const a of accepted) insertMessage(db, a.rows, a.text, 'initial', batch.id, userId, at);
      writeAudit(db, {
        action: 'send_batch.started', entity: 'send_batch', entityIds: [batch.id], outcome: 'ok', userId, at,
        detail: { counts: { messages: accepted.length, parcels, skipped } },
      });
      return { ok: true as const, batchId: batch.id, queued: accepted.length, skipped, repeated: false };
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

const OUTCOME_IN: Record<Outcome, string> = { answered: 'reached', 'no-answer': 'no_answer', messaged: 'messaged' };
const OUTCOME_OUT: Record<string, Outcome> = { reached: 'answered', no_answer: 'no-answer', messaged: 'messaged' };

/** A call or Telegram message staff made outside the app, for every parcel on the line. */
export function recordContact(db: Db, input: { phone: string; parcelIds: number[]; channel: unknown; outcome: unknown }, userId: number | null, at = nowIso()) {
  const valid = (input.channel === 'call' && (input.outcome === 'answered' || input.outcome === 'no-answer')) || (input.channel === 'telegram' && input.outcome === 'messaged');
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
      return 'Sent by the phone. No delivery report yet.';
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
          : 'Not sent: the computer stopped before the phone got it.';
  }
}

/** The contact log in the shape the pages use: each message's latest attempt, then calls and Telegram. */
export function listContactEvents(db: Db): ContactEvent[] {
  const codesOf = (sql: string, id: number) => (db.prepare(sql).all(id) as { code: string }[]).map((r) => r.code);
  const messages = db
    .prepare(
      `SELECT n.id, n.phone_normalized AS phone, n.message_text, a.state, a.gateway_state, a.error_code, a.error_detail, a.queued_at
       FROM notifications n
       JOIN sms_attempts a ON a.notification_id = n.id
        AND a.attempt_no = (SELECT max(attempt_no) FROM sms_attempts WHERE notification_id = n.id)`,
    )
    .all() as { id: number; phone: string; message_text: string; state: AttemptState; gateway_state: string | null; error_code: string | null; error_detail: string | null; queued_at: string }[];
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

/** Today's latest batch, for the Notifications page's progress line. */
export function latestBatch(db: Db, now = new Date()) {
  const b = db.prepare('SELECT id, status, created_at FROM send_batches WHERE arrival_date = ? ORDER BY id DESC LIMIT 1').get(cambodiaDate(now)) as
    | { id: number; status: string; created_at: string }
    | undefined;
  if (!b) return null;
  const ids = db.prepare('SELECT id FROM notifications WHERE batch_id = ?').all(b.id) as { id: number }[];
  return { id: b.id, status: b.status as 'running' | 'paused' | 'stopped' | 'done', startedAt: b.created_at, eventIds: ids.map((r) => `sms-${r.id}`) };
}
