import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { editParcelPhone } from '@/server/db/parcels';
import { idAfter } from '@/server/importer/http';

// A staff phone edit: any signed-in staff member, audited (parcel_phone_changes plus the audit log). Empty clears it.
export const PUT = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const id = idAfter(req, 'parcels');
  const body = await readJson(req, 1024);
  if (!id || !body || typeof body.phone !== 'string' || body.phone.length > 40) return json({ error: 'invalid_request' }, 400);
  if (!db.prepare('SELECT 1 FROM parcels WHERE id = ?').get(id)) return json({ error: 'not_found' }, 404);
  editParcelPhone(db, id, body.phone, user.userId);
  return json({ ok: true });
});
