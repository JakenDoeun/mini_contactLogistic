import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { dismissDetectedFile } from '@/server/folder/folder';
import { idAfter } from '@/server/importer/http';

// Take a found file off the waiting list without reviewing it. The file itself is left in the folder.
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const id = idAfter(req, 'files');
  if (!id || !(await readJson(req))) return json({ error: 'invalid_request' }, 400);
  return dismissDetectedFile(db, id, user.userId) ? json({ ok: true }) : json({ error: 'not_waiting' }, 409);
});
