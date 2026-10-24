import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { resolveDataDir } from '@/server/db/paths';
import { routeFor, scanSims } from '@/server/gateway/sims';
import { queueMessage } from '@/server/sms/queue';

// One SMS for one phone line, from a parcel card or a retry. Any signed-in staff member; the worker sends it from the
// SIM of the customer's carrier, and a carrier with no SIM in the phone is refused (Phase 12).
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const body = await readJson(req, 16_384);
  if (!body || typeof body.phone !== 'string' || !Array.isArray(body.parcelIds) || typeof body.text !== 'string') return json({ error: 'invalid_request' }, 400);
  const retryOf = body.retryOf === undefined ? undefined : Number(body.retryOf);
  if (retryOf !== undefined && !Number.isSafeInteger(retryOf)) return json({ error: 'invalid_request' }, 400);
  const route = routeFor(await scanSims(db, resolveDataDir()));
  const r = queueMessage(db, { phone: body.phone, parcelIds: body.parcelIds.map(Number), text: body.text, again: body.again === true, retryOf }, user.userId, undefined, route);
  return r.ok ? json(r) : json(r, r.error === 'not_found' ? 404 : 409);
});
