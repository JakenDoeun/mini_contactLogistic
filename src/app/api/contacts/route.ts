import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { recordContact } from '@/server/sms/queue';

// A call or Telegram message made outside the app. A reached call stops the SMS for those parcels.
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const body = await readJson(req, 4096);
  if (!body || typeof body.phone !== 'string' || !Array.isArray(body.parcelIds)) return json({ error: 'invalid_request' }, 400);
  const r = recordContact(db, { phone: body.phone, parcelIds: body.parcelIds.map(Number), channel: body.channel, outcome: body.outcome }, user.userId);
  return r.ok ? json(r) : json(r, r.error === 'not_found' ? 404 : 409);
});
