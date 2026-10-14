/** Where to go after signing in: only a path on this site (no `//host` or `/\host`), else the dashboard. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
  if (/[\u0000-\u001f]/.test(next) || next.startsWith('/login')) return '/dashboard';
  return next;
}
