import { logOut } from '@/server/auth/accounts';
import { clearedSessionCookie, readSessionToken } from '@/server/auth/cookie';
import { databaseUnavailable, dbOrNull, json, refuseCrossSite } from '@/server/auth/guard';

export async function POST(req: Request) {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const db = dbOrNull();
  if (!db) return databaseUnavailable();
  const ended = logOut(db, readSessionToken(req.headers.get('cookie')));
  // The cookie is cleared either way; without a valid session the answer is still 401, like every protected route.
  return json(ended ? { ok: true } : { error: 'unauthorized' }, ended ? 200 : 401, { 'Set-Cookie': clearedSessionCookie() });
}
