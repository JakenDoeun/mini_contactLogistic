// The SMS worker (plan Revision 4): one message at a time. Save Sending, hand it to the phone under its own ID, save
// Accepted when the phone answers, then ask the phone until it is Sent, Delivered or Failed. So at most one message
// can be uncertain after a crash, and nothing is ever resent automatically:
// - after a restart, Sending with no record on the phone becomes Not sent, and Sending the phone cannot be asked
//   about becomes Check phone;
// - Accepted with no record on the phone becomes Check phone, never Not sent.
// The launcher (scripts/serve.ts) runs it beside backups; a lease keeps a second copy from sending.
import crypto from 'node:crypto';
import type { Db } from '../db/connection.ts';
import { GatewayError, readGatewayConfig, smsGate, type GatewayState, type MessageState, type SmsGate } from '../gateway/smsgate.ts';
import { readSetting, writeSetting } from '../db/settings.ts';
import { smsGap } from '../settings/app-settings.ts';
import { carrierOf } from '../../lib/carriers.ts';
import { scanSims } from '../gateway/sims.ts';
import { PHONE_AWAY, restoreHold, SIM_MISSING, SIM_PAUSE, type AttemptState } from './queue.ts';
import { backfillDaily, countSms } from './usage.ts';
import { cambodiaDate } from '../db/values.ts';

const LEASE_MS = 60_000;
// A phone that says Processed this long without a result is not going to say more (plan, status mapping).
const PROCESSED_LIMIT_MS = 3600_000;
// Sent waits for a delivery report; after this the report is not coming and the phone is left alone.
const SENT_WATCH_MS = 3600_000;
const pollEvery = (ageMs: number) => (ageMs < 120_000 ? 3_000 : 30_000);
export const randomGap = (g: { from: number; to: number }) => (g.from + Math.random() * (g.to - g.from)) * 1000;

interface Attempt {
  id: string;
  notification_id: number;
  state: AttemptState;
  gateway_state: string | null;
  queued_at: string;
  submitted_at: string | null;
  sent_at: string | null;
  last_checked_at: string | null;
  sim_number: number | null;
}

export function smsWorker(
  db: Db,
  dataDir: string,
  log: (line: string) => void,
  options: { make?: typeof smsGate; now?: () => number; gap?: () => number } = {},
) {
  const make = options.make ?? smsGate;
  const now = options.now ?? Date.now;
  const gap = options.gap ?? (() => randomGap(smsGap(db))); // read each time, so a change in Settings applies to the next gap
  let nextSendAt: number | null = null; // no hand-over before this time
  const holder = crypto.randomUUID();
  const iso = () => new Date(now()).toISOString();
  let recovered = false;
  let busy = false;
  let changed = false;

  const update = (id: string, fields: Record<string, string | null>) => {
    const keys = Object.keys(fields);
    changed = true;
    db.prepare(`UPDATE sms_attempts SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
  };

  function holdLease() {
    // Renewed only when half used, so an idle worker does not write to the disk every round.
    const mine = db.prepare('SELECT expires_at FROM worker_lease WHERE id = 1 AND holder = ?').get(holder) as { expires_at: string } | undefined;
    if (mine && Date.parse(mine.expires_at) - now() > LEASE_MS / 2) return true;
    const at = iso();
    const expires = new Date(now() + LEASE_MS).toISOString();
    const r = db
      .prepare(
        `INSERT INTO worker_lease (id, holder, expires_at) VALUES (1, @holder, @expires)
         ON CONFLICT (id) DO UPDATE SET holder = @holder, expires_at = @expires WHERE holder = @holder OR expires_at < @at`,
      )
      .run({ holder, expires, at });
    return r.changes === 1;
  }

  /** Puts what the phone reports on the attempt. Pending and Processed stay Accepted. */
  function apply(a: Attempt, m: MessageState) {
    const at = iso();
    const fields: Record<string, string | null> = { gateway_state: m.state, last_checked_at: at };
    const mapped: Partial<Record<GatewayState, AttemptState>> = { Sent: 'sent', Delivered: 'delivered', Failed: 'failed' };
    const next = mapped[m.state];
    if (next) {
      fields.state = next;
      if (next === 'sent' || next === 'delivered') fields.sent_at = a.sent_at ?? at;
      if (next === 'delivered') fields.delivered_at = at;
      if (next === 'failed') Object.assign(fields, { failed_at: at, error_code: 'gateway_failed', error_detail: m.error?.slice(0, 200) ?? null });
    } else if (a.state === 'submitting') {
      fields.state = 'submitted';
      fields.submitted_at = a.submitted_at ?? at;
    } else if (m.state === 'Processed' && a.submitted_at && now() - Date.parse(a.submitted_at) > PROCESSED_LIMIT_MS) {
      Object.assign(fields, { state: 'unconfirmed', error_code: 'no_result' });
    }
    update(a.id, fields);
    if ((next === 'sent' || next === 'delivered') && !a.sent_at) countSms(db, a.id, 'sent', at);
    if (next === 'failed') countSms(db, a.id, 'failed', at);
    if (fields.state === 'failed') pauseOnFailStreak(a.sim_number);
  }

  /**
   * Two failures in a row from one SIM (a call on the phone, no credit, a blocked SIM) pause the run until staff check
   * the phone and press Resume (owner, 2026-10-23). Nothing is resent on its own.
   */
  function pauseOnFailStreak(sim: number | null) {
    if (sim === null) return;
    const last = db
      .prepare(
        `SELECT state FROM sms_attempts WHERE sim_number = ? AND state IN ('sent', 'delivered', 'failed')
         ORDER BY coalesce(failed_at, sent_at, submitted_at) DESC LIMIT 2`,
      )
      .all(sim) as { state: AttemptState }[];
    if (last.length < 2 || last.some((r) => r.state !== 'failed')) return;
    const paused = db.prepare(`UPDATE send_batches SET status = 'paused' WHERE status = 'running'`).run();
    if (paused.changes) {
      writeSetting(db, SIM_PAUSE, { sim, at: iso() }, null, iso());
      log(`SMS: SIM ${sim} failed twice in a row; the run is paused until staff resume it`);
    }
  }

  /** Waiting messages whose SIM is missing, saved so the pages can say which SIM; written only on a change. */
  function simMissing(sims: number[]) {
    const now_ = readSetting(db, SIM_MISSING) as { sims: number[] } | undefined;
    if (JSON.stringify(now_?.sims ?? []) === JSON.stringify(sims)) return;
    if (sims.length) writeSetting(db, SIM_MISSING, { sims, since: iso() }, null, iso());
    else db.prepare('DELETE FROM settings WHERE key = ?').run(SIM_MISSING);
  }

  function finishBatches() {
    const r = db.prepare(
      `UPDATE send_batches SET status = 'done' WHERE status IN ('running', 'paused') AND NOT EXISTS (
         SELECT 1 FROM notifications n JOIN sms_attempts a ON a.notification_id = n.id
         WHERE n.batch_id = send_batches.id AND a.state IN ('queued', 'submitting'))`,
    ).run();
    if (r.changes) changed = true;
  }

  const open = (states: AttemptState[]) =>
    db.prepare(`SELECT * FROM sms_attempts WHERE state IN (${states.map(() => '?').join(', ')}) ORDER BY queued_at, attempt_no`).all(...states) as Attempt[];

  /**
   * An SMS still waiting from an earlier Cambodia day is never sent by itself: it may tell a customer about a parcel
   * days late, after staff already told them by hand. It shows on Notifications for staff to send again or clear
   * (owner, 2026-10-29).
   */
  function holdPastDays() {
    const r = db
      .prepare(`UPDATE sms_attempts SET state = 'cancelled', error_code = 'stale', failed_at = @at WHERE state = 'queued' AND date(queued_at, '+7 hours') < @today`)
      .run({ at: iso(), today: cambodiaDate(new Date(now())) });
    if (r.changes) {
      changed = true;
      log(`SMS: held back ${r.changes} SMS queued on an earlier day; staff decide on Notifications`);
    }
  }

  /** On start, before anything new: settle what a crash may have left half done. */
  async function recover(gate: SmsGate) {
    if (backfillDaily(db)) changed = true; // first start of v0.2.1: totals from the SMS records still kept
    for (const a of open(['submitting', 'submitted'])) {
      let found: MessageState | null;
      try {
        found = await gate.lookup(a.id);
      } catch (e) {
        if (!(e instanceof GatewayError)) throw e;
        // Accepted ones are on the phone and are asked again later; a half-sent one cannot wait.
        if (a.state === 'submitting') update(a.id, { state: 'unconfirmed', error_code: 'unreachable', last_checked_at: iso() });
        continue;
      }
      if (found) apply(a, found);
      else if (a.state === 'submitting') update(a.id, { state: 'cancelled', error_code: 'restart_not_sent', failed_at: iso(), last_checked_at: iso() });
      else update(a.id, { state: 'unconfirmed', error_code: 'missing_on_phone', last_checked_at: iso() });
      log(`SMS: settled an attempt left ${a.state} by a restart`);
    }
    recovered = true;
  }

  async function poll(gate: SmsGate) {
    for (const a of open(['submitted', 'sent'])) {
      const since = Date.parse(a.sent_at ?? a.submitted_at ?? a.queued_at);
      if (a.state === 'sent' && now() - since > SENT_WATCH_MS) continue;
      if (a.last_checked_at && now() - Date.parse(a.last_checked_at) < pollEvery(now() - since)) continue;
      let found: MessageState | null;
      try {
        found = await gate.lookup(a.id);
      } catch (e) {
        if (!(e instanceof GatewayError)) throw e;
        return; // the phone is away; ask again next time
      }
      if (found) apply(a, found);
      else if (a.state === 'submitted') update(a.id, { state: 'unconfirmed', error_code: 'missing_on_phone', last_checked_at: iso() });
      else update(a.id, { last_checked_at: iso() }); // Sent and since deleted on the phone: it stays Sent
    }
  }

  /** Saves when the phone stopped answering a hand-over, and clears it once it answers; written only on a change. */
  function phoneAway(away: boolean) {
    if (away === !!readSetting(db, PHONE_AWAY)) return;
    if (away) writeSetting(db, PHONE_AWAY, { since: iso() }, null, iso());
    else db.prepare('DELETE FROM settings WHERE key = ?').run(PHONE_AWAY);
  }

  /**
   * The oldest waiting message whose SIM is in the phone now, still confirmed for its customer's carrier (Phase 12).
   * Messages for a missing SIM wait; the others go on. Messages from before Phase 12 have no SIM and go as before.
   * A paused batch holds its messages. A stopped batch cancels its waiting ones, so what waits in a stopped or done
   * batch is a staff Retry, which goes like any single message.
   */
  async function nextMessage() {
    const waiting = db
      .prepare(
        `SELECT a.*, n.phone_normalized AS phone FROM sms_attempts a JOIN notifications n ON n.id = a.notification_id
         LEFT JOIN send_batches b ON b.id = n.batch_id
         WHERE a.state = 'queued' AND (b.id IS NULL OR b.status <> 'paused')
         ORDER BY a.queued_at, a.attempt_no`,
      )
      .all() as (Attempt & { phone: string })[];
    if (!waiting.some((a) => a.sim_number !== null)) return waiting[0];
    const scan = await scanSims(db, dataDir, make);
    if (scan.problem) {
      // The phone cannot say which SIMs it has, so nothing is handed over yet.
      if (scan.problemKind === 'unreachable' || scan.problemKind === 'timeout') phoneAway(true);
      else log(`SMS: the gateway phone's SIMs could not be read: ${scan.problem}`);
      return undefined;
    }
    const ready = (a: Attempt & { phone: string }) =>
      a.sim_number === null || scan.sims.some((s) => s.simNumber === a.sim_number && s.carrier !== null && s.carrier === carrierOf(a.phone));
    simMissing([...new Set(waiting.filter((a) => !ready(a)).map((a) => a.sim_number!))].sort());
    return waiting.find(ready);
  }

  /** Hands the oldest waiting message to the phone, unless one is already being handed over. */
  async function sendNext(gate: SmsGate) {
    if (open(['submitting']).length || restoreHold(db)) return; // after a restore, nothing goes until staff check the phone
    if (nextSendAt !== null && now() < nextSendAt) return; // no need to ask the phone for its SIMs before the gap ends
    const next = await nextMessage();
    if (!next) return;
    if (nextSendAt === null) {
      // After a restart the gap still counts from the last hand-over.
      const last = db.prepare('SELECT max(submitted_at) AS at FROM sms_attempts').get() as { at: string | null };
      nextSendAt = last.at ? Date.parse(last.at) + gap() : 0;
    }
    if (now() < nextSendAt) return;
    const n = db.prepare('SELECT phone_normalized, message_text, reason FROM notifications WHERE id = ?').get(next.notification_id) as {
      phone_normalized: string;
      message_text: string;
      reason: string;
    };
    const reached = db
      .prepare(
        `SELECT 1 FROM notification_parcels np JOIN contact_attempt_parcels cp ON cp.parcel_id = np.parcel_id
         JOIN contact_attempts c ON c.id = cp.contact_attempt_id
         WHERE np.notification_id = ? AND c.outcome = 'reached' AND c.created_at > ? LIMIT 1`,
      )
      .get(next.notification_id, next.queued_at);
    if (reached) {
      update(next.id, { state: 'cancelled', error_code: 'reached', failed_at: iso() });
      return;
    }

    update(next.id, { state: 'submitting', submitted_at: null }); // saved before the phone hears of it
    let result: Awaited<ReturnType<SmsGate['send']>>;
    try {
      result = await gate.send({ id: next.id, phone: n.phone_normalized, text: n.message_text, simNumber: next.sim_number });
      nextSendAt = now() + gap();
      phoneAway(false);
    } catch (e) {
      if (!(e instanceof GatewayError)) throw e;
      phoneAway(e.problem === 'unreachable');
      if (e.problem !== 'unreachable') nextSendAt = now() + gap();
      if (e.problem === 'unreachable') {
        update(next.id, { state: 'queued' }); // nothing left this computer, so it waits for the phone
      } else if (e.problem === 'auth') {
        update(next.id, { state: 'failed', error_code: 'auth', failed_at: iso() });
        countSms(db, next.id, 'failed', iso());
        db.prepare(`UPDATE send_batches SET status = 'paused' WHERE status = 'running'`).run();
        log('SMS: the gateway refused its password; batches paused');
      } else {
        update(next.id, { state: 'failed', error_code: 'refused', error_detail: e.message.slice(0, 200), failed_at: iso() });
        countSms(db, next.id, 'failed', iso());
        pauseOnFailStreak(next.sim_number);
      }
      return;
    }
    if (result.outcome === 'accepted') {
      update(next.id, { state: 'submitted', gateway_state: 'Pending', submitted_at: iso() });
      return;
    }
    // No answer in time: the phone may have it. Ask by ID; the same ID sent again is refused there, so it is safe.
    try {
      const found = await gate.lookup(next.id);
      if (found) apply({ ...next, state: 'submitting' }, found);
      else update(next.id, { state: 'queued' });
    } catch (e) {
      if (!(e instanceof GatewayError)) throw e;
      update(next.id, { state: 'unconfirmed', error_code: 'unreachable', last_checked_at: iso() });
    }
  }

  return {
    /**
     * One round: recover once, ask about open messages, send the next one. Never runs twice at the same time.
     * Returns true when it saved something, so the launcher's backup knows (its own writes do not show as changes).
     */
    async tick() {
      if (busy) return false;
      busy = true;
      changed = false;
      try {
        if (!holdLease()) return false;
        const config = readGatewayConfig(dataDir);
        if (!config) return false; // not set up: messages wait as Queued
        const gate = make(config);
        if (!recovered) await recover(gate);
        await poll(gate);
        holdPastDays();
        await sendNext(gate);
        finishBatches();
      } catch (e) {
        log(`SMS worker: ${(e as Error).message}`);
      } finally {
        busy = false;
      }
      return changed;
    },
    release() {
      db.prepare('DELETE FROM worker_lease WHERE holder = ?').run(holder);
    },
  };
}
