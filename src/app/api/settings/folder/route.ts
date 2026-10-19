import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { folderState, setFolderSettings } from '@/server/folder/folder';

// The watched folder, automatic checking (off by default) and its interval. Admin only; audited without the path.
export const PUT = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const body = await readJson(req, 2048);
  if (!body) return json({ error: 'invalid_request' }, 400);
  const result = setFolderSettings(db, user.userId, body);
  if (!result.ok) return json({ error: result.reason, message: result.message }, result.reason === 'not_admin' ? 403 : 400);
  return json({ ...folderState(db), isAdmin: user.isAdmin });
});
