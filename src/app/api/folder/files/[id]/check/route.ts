import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { resolveDataDir } from '@/server/db/paths';
import { checkDetectedFile } from '@/server/folder/folder';
import { idAfter } from '@/server/importer/http';

// Open the review of a file found in the watched folder: the same check as a manual upload, saved for review.
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const id = idAfter(req, 'files');
  if (!id || !(await readJson(req))) return json({ error: 'invalid_request' }, 400);
  const result = checkDetectedFile(db, resolveDataDir(), id, user.userId);
  if (result.ok) return json(result, 201);
  return json({ error: result.reason === 'not_found' ? 'gone' : result.reason, message: result.message }, result.reason === 'not_found' ? 404 : 409);
});
