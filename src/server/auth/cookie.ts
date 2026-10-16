// The session cookie. `__Host-` makes the browser refuse it unless it is Secure, has Path=/ and no Domain, so no other
// site or subdomain can set or read it. Browsers treat http://127.0.0.1 and http://localhost as secure for this.
import { SESSION_MAX_MS } from './sessions.ts';

export const SESSION_COOKIE = '__Host-cb_session';
const ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Lax';

export const sessionCookie = (token: string) => `${SESSION_COOKIE}=${token}; Max-Age=${Math.floor(SESSION_MAX_MS / 1000)}; ${ATTRIBUTES}`;
export const clearedSessionCookie = () => `${SESSION_COOKIE}=; Max-Age=0; ${ATTRIBUTES}`;

/** The session token from a Cookie header, or null. */
export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim() || null;
  }
  return null;
}
