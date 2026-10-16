// Redirects only (plan, Security): a visitor without a session cookie goes to the login page. This is not the security
// boundary; it never reads the database. Every API route and server page checks the session itself.
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/server/auth/cookie';

export function proxy(req: NextRequest) {
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

// Not for API routes (they answer 401 themselves), the login and phone Setup pages, or files.
export const config = {
  matcher: ['/((?!api/|_next/|login|setup|favicon\\.ico|.*\\.[a-z0-9]+$).*)'],
};
