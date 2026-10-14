// Cross-site protection for changes (plan: "any non-GET request must carry an Origin matching the branch address").
// Together with SameSite=Lax cookies this blocks requests forged by other sites.
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Allowed: exactly the branch address (BRANCH_URL or the Tailscale Serve name), or a loopback origin that is also the
 * host the request was sent to (the office computer itself). A missing, opaque ("null") or malformed Origin is refused.
 */
export function originAllowed(origin: string | null, host: string | null, branchOrigin: string | null): boolean {
  if (!origin || origin === 'null') return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (branchOrigin && origin === branchOrigin) return true;
  return LOOPBACK.has(url.hostname) && url.protocol === 'http:' && host !== null && url.host === host;
}
