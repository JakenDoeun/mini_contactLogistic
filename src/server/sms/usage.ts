// The daily SMS totals behind the Dashboard's SMS sent (v0.2.1). The worker adds to them the moment an SMS is sent or
// fails, so they hold even when retention (1 to 14 days) has removed the SMS records themselves.
import type { Db } from '../db/connection.ts';
import { cambodiaDate } from '../db/values.ts';
import { smsParts, type DayTotal } from '../../lib/sms-usage.ts';

const add = (db: Db, row: DayTotal) =>
  db
    .prepare(
      `INSERT INTO sms_daily (day, sim, sms, parts, failed) VALUES (@day, @sim, @sms, @parts, @failed)
       ON CONFLICT (day, sim) DO UPDATE SET sms = sms + excluded.sms, parts = parts + excluded.parts, failed = failed + excluded.failed`,
    )
    .run(row);

/** One attempt was sent (counted with its parts) or failed, at `at`. */
export function countSms(db: Db, attemptId: string, kind: 'sent' | 'failed', at: string) {
  const a = db
    .prepare('SELECT a.sim_number AS sim, n.message_text AS text FROM sms_attempts a JOIN notifications n ON n.id = a.notification_id WHERE a.id = ?')
    .get(attemptId) as { sim: number | null; text: string } | undefined;
  if (!a) return;
  const sent = kind === 'sent';
  add(db, { day: cambodiaDate(new Date(at)), sim: a.sim ?? 0, sms: sent ? 1 : 0, parts: sent ? smsParts(a.text) : 0, failed: sent ? 0 : 1 });
}

/**
 * Once, on the first start of v0.2.1 (the table is still empty): totals from the SMS records retention has kept, so
 * the Dashboard does not start blank.
 */
export function backfillDaily(db: Db) {
  if (db.prepare('SELECT 1 FROM sms_daily LIMIT 1').get()) return 0;
  const rows = db
    .prepare(
      `SELECT a.state, a.sent_at, a.failed_at, a.sim_number AS sim, n.message_text AS text FROM sms_attempts a
       JOIN notifications n ON n.id = a.notification_id WHERE a.state IN ('sent', 'delivered', 'failed')`,
    )
    .all() as { state: string; sent_at: string | null; failed_at: string | null; sim: number | null; text: string }[];
  let n = 0;
  db.transaction(() => {
    for (const r of rows) {
      const at = r.state === 'failed' ? r.failed_at : r.sent_at;
      if (!at) continue;
      const sent = r.state !== 'failed';
      add(db, { day: cambodiaDate(new Date(at)), sim: r.sim ?? 0, sms: sent ? 1 : 0, parts: sent ? smsParts(r.text) : 0, failed: sent ? 0 : 1 });
      n++;
    }
  })();
  return n;
}

/** The daily totals from `since` (YYYY-MM-DD) on. */
export const readDaily = (db: Db, since: string) =>
  db.prepare('SELECT day, sim, sms, parts, failed FROM sms_daily WHERE day >= ? ORDER BY day, sim').all(since) as DayTotal[];
