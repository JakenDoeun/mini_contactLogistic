import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { resolveDataDir } from '@/server/db/paths';
import { refreshTestSms, sendTestSms, type TestSim } from '@/server/gateway/status';

// A test SMS to a staff number (Phase 8 gate): by carrier, from one SIM, or one from each SIM (Phase 12). Admin only:
// it costs the branch SIMs a message each.
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  if (!user.isAdmin) return json({ error: 'not_admin', message: 'Only an admin can send a test SMS.' }, 403);
  const body = await readJson(req, 1024);
  if (!body || typeof body.phone !== 'string' || body.phone.length > 40) return json({ error: 'invalid_request' }, 400);
  const sim: unknown = body.sim ?? 'auto';
  if (sim !== 'auto' && sim !== 'both' && !(typeof sim === 'number' && Number.isInteger(sim) && sim >= 1 && sim <= 8)) return json({ error: 'invalid_request' }, 400);
  const result = await sendTestSms(db, resolveDataDir(), user.userId, body.phone, sim as TestSim);
  if (!result.ok) return json({ error: result.error, message: result.message }, ['invalid_phone', 'no_sim', 'sim_missing'].includes(result.error) ? 400 : 502);
  return json({ tests: result.tests });
});

/** The test SMS states as the phone reports them now; Settings asks every few seconds until they are final. */
export const GET = withSession(async (_req, _user, db) => json({ tests: await refreshTestSms(db, resolveDataDir()) }));
