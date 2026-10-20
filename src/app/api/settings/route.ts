import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { appSettings, saveAppSettings } from '@/server/settings/app-settings';

// The shared settings: export column headings, the duplicate-file rule and the SMS wording. Any staff member reads
// them (the SMS wording is needed to send); only the admin changes them.
export const GET = withSession((_req, user, db) => json({ settings: appSettings(db), isAdmin: user.isAdmin }));

export const PUT = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const body = await readJson(req, 4096);
  if (!body) return json({ error: 'invalid_request' }, 400);
  const result = saveAppSettings(db, user.userId, body);
  if (!result.ok) return json({ error: result.reason, message: result.message }, result.reason === 'not_admin' ? 403 : 400);
  return json({ settings: result.settings, isAdmin: user.isAdmin });
});
