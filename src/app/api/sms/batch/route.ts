import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { notifyToday, type NotifyItem } from '@/server/sms/queue';

// "Notify today's customers": one batch, re-checked on the server; the same request key twice creates nothing.
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const body = await readJson(req, 512_000);
  if (!body || typeof body.requestKey !== 'string' || !Array.isArray(body.items)) return json({ error: 'invalid_request' }, 400);
  const items = body.items as Partial<NotifyItem>[];
  if (!items.every((i) => typeof i?.phone === 'string' && typeof i.text === 'string' && Array.isArray(i.parcelIds))) return json({ error: 'invalid_request' }, 400);
  const r = notifyToday(db, body.requestKey, items.map((i) => ({ phone: i.phone!, text: i.text!, parcelIds: i.parcelIds!.map(Number) })), user.userId);
  return r.ok ? json(r) : json(r, 409);
});
