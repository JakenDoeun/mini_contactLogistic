import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { releaseRestoreHold } from '@/server/sms/queue';

// After a restore: staff checked the gateway phone. Lines they saw an SMS for are saved as Sent; then sending resumes.
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const body = await readJson(req, 128_000);
  const seen = body?.seen as { phone?: unknown; parcelIds?: unknown }[] | undefined;
  if (!Array.isArray(seen) || seen.length > 500 || !seen.every((l) => typeof l?.phone === 'string' && Array.isArray(l.parcelIds))) {
    return json({ error: 'invalid_request' }, 400);
  }
  const r = releaseRestoreHold(db, seen.map((l) => ({ phone: l.phone as string, parcelIds: (l.parcelIds as unknown[]).map(Number) })), user.userId);
  return r.ok ? json(r) : json(r, 409);
});
