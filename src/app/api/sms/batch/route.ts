import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { resolveDataDir } from '@/server/db/paths';
import { routeFor, scanSims } from '@/server/gateway/sims';
import { gatewayState, notifyDay, type NotifyItem } from '@/server/sms/queue';

// "Notify today's customers" or one earlier day's: one batch for one arrival day, re-checked on the server; an earlier
// day needs `checked`. The same request key twice creates nothing. Each SMS goes from the SIM of its customer's carrier,
// scanned from the phone now (the last scan when it cannot be asked); the others are left to contact by hand.
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const body = await readJson(req, 512_000);
  if (!body || typeof body.requestKey !== 'string' || typeof body.day !== 'string' || !Array.isArray(body.items)) return json({ error: 'invalid_request' }, 400);
  const items = body.items as Partial<NotifyItem>[];
  if (!items.every((i) => typeof i?.phone === 'string' && typeof i.text === 'string' && Array.isArray(i.parcelIds))) return json({ error: 'invalid_request' }, 400);
  if (!gatewayState(db, resolveDataDir()).setUp) {
    return json({ ok: false, error: 'no_gateway', message: 'No gateway phone is set up yet. Set it up first; see SMS gateway in Settings.' }, 409);
  }
  const route = routeFor(await scanSims(db, resolveDataDir()));
  const r = notifyDay(
    db,
    { requestKey: body.requestKey, day: body.day, checked: body.checked === true, items: items.map((i) => ({ phone: i.phone!, text: i.text!, parcelIds: i.parcelIds!.map(Number) })) },
    user.userId,
    new Date(),
    route,
  );
  return r.ok ? json(r) : json(r, 409);
});
