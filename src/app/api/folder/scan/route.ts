import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { folderState, scanFolder } from '@/server/folder/folder';

// Scan Folder Now: record finished export files in the watched folder. Nothing is imported here.
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  if (!(await readJson(req))) return json({ error: 'invalid_request' }, 400);
  const result = await scanFolder(db, 'manual', undefined, user.userId);
  return json({ result, ...folderState(db), isAdmin: user.isAdmin });
});
