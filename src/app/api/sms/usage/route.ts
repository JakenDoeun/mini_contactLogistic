import { json, withSession } from '@/server/auth/guard';
import { cambodiaDate } from '@/server/db/values';
import { readDaily } from '@/server/sms/usage';

// The Dashboard's SMS sent (v0.2.1): daily totals per SIM for about the last year; the page groups them into weeks or
// months. Counts only, no names or numbers.
export const GET = withSession((_req, _user, db) => {
  const now = new Date();
  const since = cambodiaDate(new Date(now.getTime() - 400 * 86_400_000));
  return json({ today: cambodiaDate(now), days: readDaily(db, since) });
});
