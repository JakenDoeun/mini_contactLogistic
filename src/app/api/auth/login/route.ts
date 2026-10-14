import { logIn } from '@/server/auth/accounts';
import { sessionCookie } from '@/server/auth/cookie';
import { databaseUnavailable, dbOrNull, json, readJson, refuseCrossSite } from '@/server/auth/guard';

// Public by necessity: this is how a session starts. Cross-site requests are refused.
export async function POST(req: Request) {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const body = await readJson(req);
  if (!body) return json({ error: 'bad_request' }, 400);
  const db = dbOrNull();
  if (!db) return databaseUnavailable();
  const result = await logIn(db, body.username, body.password);
  if (result.ok) return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(result.token) });
  if (result.reason === 'paused') return json({ error: 'paused', retryAfter: result.retryAfter }, 429, { 'Retry-After': String(result.retryAfter) });
  return json({ error: 'invalid_credentials' }, 401);
}
