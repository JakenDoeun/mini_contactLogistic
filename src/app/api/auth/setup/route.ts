import { createFirstAccount } from '@/server/auth/accounts';
import { sessionCookie } from '@/server/auth/cookie';
import { databaseUnavailable, dbOrNull, json, readJson, refuseCrossSite } from '@/server/auth/guard';
import { resolveDataDir } from '@/server/db/paths';

// Public only while no account exists, and only with the one-time code from the data folder (first-run screen).
export async function POST(req: Request) {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const body = await readJson(req);
  if (!body) return json({ error: 'bad_request' }, 400);
  const db = dbOrNull();
  if (!db) return databaseUnavailable();
  const result = await createFirstAccount(db, resolveDataDir(), body.code, body.username, body.password);
  if (result.ok) return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(result.token) });
  switch (result.reason) {
    case 'exists':
      return json({ error: 'account_exists' }, 409);
    case 'bad_code':
      return json({ error: 'bad_code' }, 403);
    case 'paused':
      return json({ error: 'paused', retryAfter: result.retryAfter }, 429, { 'Retry-After': String(result.retryAfter) });
    default:
      return json({ error: result.reason }, 400);
  }
}
