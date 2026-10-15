import { clearedSessionCookie } from '@/server/auth/cookie';
import { databaseUnavailable, dbOrNull, json, readJson, refuseCrossSite } from '@/server/auth/guard';
import { recoverPassword } from '@/server/auth/recovery';
import { resolveDataDir } from '@/server/db/paths';

// Public by necessity: the person has lost their password. Needs the recovery code from the office computer; on success
// every session of the account has ended and the person signs in again with the new password.
export async function POST(req: Request) {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const body = await readJson(req);
  if (!body) return json({ error: 'bad_request' }, 400);
  const db = dbOrNull();
  if (!db) return databaseUnavailable();
  const result = await recoverPassword(db, resolveDataDir(), body.username, body.code, body.password);
  if (result.ok) return json({ ok: true }, 200, { 'Set-Cookie': clearedSessionCookie() });
  if (result.reason === 'paused') return json({ error: 'paused', retryAfter: result.retryAfter }, 429, { 'Retry-After': String(result.retryAfter) });
  if (result.reason === 'invalid_password') return json({ error: 'invalid_password' }, 400);
  return json({ error: 'bad_recovery' }, 403);
}
