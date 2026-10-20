import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { idAfter } from '@/server/importer/http';
import { controlBatch } from '@/server/sms/queue';

// Pause, resume or stop a running batch. Stop cancels only messages still waiting their turn.
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const id = idAfter(req, 'batch');
  const body = await readJson(req, 1024);
  const action = body?.action;
  if (!id || (action !== 'pause' && action !== 'resume' && action !== 'stop')) return json({ error: 'invalid_request' }, 400);
  const r = controlBatch(db, id, action, user.userId);
  return r.ok ? json(r) : json(r, r.error === 'not_found' ? 404 : 409);
});
