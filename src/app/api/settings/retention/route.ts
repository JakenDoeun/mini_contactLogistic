import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { retentionDays, setRetentionDays } from '@/server/db/retention';

// Only the admin account changes how long customer data is kept (1–14 days); every attempt is audited.
export const PUT = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const body = await readJson(req);
  if (!body) return json({ error: 'invalid_request' }, 400);
  const result = setRetentionDays(db, user.userId, body.days);
  if (!result.ok) return json({ error: result.reason }, result.reason === 'not_admin' ? 403 : 400);
  return json({ retentionDays: retentionDays(db) });
});
