import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { resolveDataDir } from '@/server/db/paths';
import { confirmSim, scanSims } from '@/server/gateway/sims';

// The gateway phone's SIMs (Phase 12): scanned from the phone now, with the carrier staff confirmed for each.
export const GET = withSession(async (_req, _user, db) => {
  const { problemKind: _, ...scan } = await scanSims(db, resolveDataDir());
  return json(scan);
});

/** A staff member says which carrier a scanned SIM is. Any signed-in staff member (owner, 2026-10-23); audited. */
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const body = await readJson(req, 1024);
  if (!body) return json({ error: 'invalid_request' }, 400);
  const r = confirmSim(db, user.userId, { simNumber: body.simNumber, carrier: body.carrier, ownNumber: body.ownNumber });
  return r.ok ? json(r.state) : json(r, r.error === 'not_found' ? 404 : 400);
});
