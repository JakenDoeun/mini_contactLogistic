import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { resolveDataDir } from '@/server/db/paths';
import { refreshTestSms, sendTestSms } from '@/server/gateway/status';

// One test SMS to a staff number (Phase 8 gate). Admin only: it costs the branch SIM a message.
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  if (!user.isAdmin) return json({ error: 'not_admin', message: 'Only an admin can send a test SMS.' }, 403);
  const body = await readJson(req, 1024);
  if (!body || typeof body.phone !== 'string' || body.phone.length > 40) return json({ error: 'invalid_request' }, 400);
  const result = await sendTestSms(db, resolveDataDir(), user.userId, body.phone);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.error === 'invalid_phone' ? 400 : 502);
  return json({ test: result.test });
});

/** The test SMS's state as the phone reports it now; Settings asks every few seconds until it is final. */
export const GET = withSession(async (_req, _user, db) => json({ test: await refreshTestSms(db, resolveDataDir()) }));
