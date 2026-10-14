// Session and origin checks for route handlers. Every protected API route calls these itself: proxy.ts only redirects
// pages and is not a security boundary (plan, Security: 2026 advisories showed middleware/proxy checks bypassed).
import { appDb } from '../db/app-db.ts';
import type { Db } from '../db/connection.ts';
import { branchOrigin } from '../../lib/tailscale.ts';
import { readSessionToken } from './cookie.ts';
import { originAllowed } from './origin.ts';
import { findSession, type SessionUser } from './sessions.ts';

const NO_STORE = { 'Cache-Control': 'no-store' };

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...headers } });

export const unauthorized = () => json({ error: 'unauthorized' }, 401);
export const databaseUnavailable = () => json({ error: 'database_unavailable' }, 503);

/** The verified database, or null when it is missing or not fully migrated (the route answers 503). */
export function dbOrNull(): Db | null {
  try {
    return appDb();
  } catch (e) {
    console.error(`Database not available: ${(e as Error).message}`);
    return null;
  }
}

/** Wraps a handler so it runs only for a valid session; otherwise 401 (or 503 if the database is not ready). */
export function withSession(handler: (req: Request, user: SessionUser, db: Db) => Response | Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const db = dbOrNull();
    if (!db) return databaseUnavailable();
    const user = findSession(db, readSessionToken(req.headers.get('cookie')));
    if (!user) return unauthorized();
    return handler(req, user, db);
  };
}

let cachedBranch: { at: number; origin: Promise<string | null> } | undefined;
/** The branch address, refreshed at most once a minute (it may run the tailscale CLI). */
function currentBranchOrigin(): Promise<string | null> {
  if (!cachedBranch || Date.now() - cachedBranch.at > 60_000) {
    cachedBranch = { at: Date.now(), origin: branchOrigin().then((b) => b.origin).catch(() => null) };
  }
  return cachedBranch.origin;
}

/** For every non-GET route: null if the Origin is allowed, else the 403 response to return. */
export async function refuseCrossSite(req: Request): Promise<Response | null> {
  const ok = originAllowed(req.headers.get('origin'), req.headers.get('host'), await currentBranchOrigin());
  return ok ? null : json({ error: 'cross_site' }, 403);
}

/** A small JSON body, or null (missing, too large or not JSON). */
export async function readJson(req: Request, maxBytes = 8192): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    const body = JSON.parse(text) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
