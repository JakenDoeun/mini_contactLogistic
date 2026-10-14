// Session check for server pages and layouts. Independent of proxy.ts: a request that gets past the proxy (for example
// with a forged cookie) is still sent to the login page here.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from './cookie.ts';
import { dbOrNull } from './guard.ts';
import { findSession, type SessionUser } from './sessions.ts';

export async function pageUser(): Promise<SessionUser | null | 'unavailable'> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const db = dbOrNull();
  if (!db) return 'unavailable';
  return token ? findSession(db, token) : null;
}

export async function requirePageUser(): Promise<SessionUser> {
  const user = await pageUser();
  if (user === 'unavailable') redirect('/login?error=unavailable');
  if (!user) redirect('/login');
  return user;
}
