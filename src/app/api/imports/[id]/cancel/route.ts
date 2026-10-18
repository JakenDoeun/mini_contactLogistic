import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { idAfter } from '@/server/importer/http';
import { cancelImport } from '@/server/importer/store';

// Drop a checked import without importing it; its review stays in the history as cancelled.
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const id = idAfter(req, 'imports');
  if (!id || !(await readJson(req))) return json({ error: 'invalid_request' }, 400);
  return cancelImport(db, id, user.userId) ? json({ ok: true }) : json({ error: 'not_checked' }, 409);
});
