// Where phones reach the console. Two ways, decided per request on the server:
// - 'tailscale': one configured https origin (BRANCH_URL, or this machine's Tailscale Serve name) with a publicly
//   trusted certificate. No IP, no port, no certificate to install on phones (docs/deploy-tailscale.md).
// - 'lan': the legacy Caddy setup by IP address (deploy/Caddyfile), worked out from how the request arrived,
//   so a changed IP or port shows up without a rebuild.

export type BranchMode = 'tailscale' | 'lan';
export type BranchAddresses = { secure: string | null; setup: string | null; mode: BranchMode };

/** BRANCH_URL must be a bare https origin, e.g. https://office-pc.example-tailnet.ts.net. Anything else is refused. */
export function canonicalOrigin(raw: string | undefined | null): string | null {
  const text = raw?.trim();
  if (!text) return null;
  try {
    const u = new URL(text);
    const bare = !u.username && !u.password && (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash;
    return u.protocol === 'https:' && bare ? u.origin : null;
  } catch {
    return null;
  }
}

const LOOPBACK = /^(localhost|127\.|\[::1\]$)/;
const port = (v: string | null) => (v && /^\d{1,5}$/.test(v) ? v : null);
const origin = (scheme: 'http' | 'https', hostname: string, p: string) =>
  `${scheme}://${hostname}${p === (scheme === 'https' ? '443' : '80') ? '' : `:${p}`}`;

/**
 * The https origin phones should use and the plain-http setup page, from how this request arrived.
 * Caddy sends the port of the other scheme in X-Branch-Http-Port / X-Branch-Https-Port. A request
 * that skipped Caddy (e.g. http://<ip>:3000) uses the ports Caddy reports, if it runs; otherwise only
 * the scheme of this request is known. Null when opened via localhost: no phone can use that.
 */
export function branchAddresses(
  headers: { get(name: string): string | null },
  caddy?: { httpPort: number | null; httpsPort: number | null },
  canonical?: string | null,
): BranchAddresses {
  // A configured origin wins over the request: it is right even when Settings is opened on localhost.
  if (canonical) return { secure: canonical, setup: `${canonical}/setup`, mode: 'tailscale' };
  let url: URL;
  try {
    url = new URL(`http://${headers.get('host')}`);
  } catch {
    return { secure: null, setup: null, mode: 'lan' };
  }
  if (LOOPBACK.test(url.hostname)) return { secure: null, setup: null, mode: 'lan' };
  const proto = headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https' ? 'https' : 'http';
  const here = url.port || (proto === 'https' ? '443' : '80');
  const viaCaddy = headers.get('x-branch-https-port') || headers.get('x-branch-http-port');
  const fromCaddy = (p: number | null | undefined) => (!viaCaddy && p ? String(p) : null);
  const https = port(headers.get('x-branch-https-port')) ?? fromCaddy(caddy?.httpsPort) ?? (proto === 'https' ? here : null);
  const http = port(headers.get('x-branch-http-port')) ?? fromCaddy(caddy?.httpPort) ?? (proto === 'http' ? here : null);
  return {
    secure: https && origin('https', url.hostname, https),
    // No plain http at all (next dev --experimental-https): the setup page opens on https after a warning.
    setup: `${http ? origin('http', url.hostname, http) : origin('https', url.hostname, https!)}/setup`,
    mode: 'lan',
  };
}

/** The addresses as seen by this browser, from the server (src/app/api/branch-address). */
export async function fetchBranchAddresses(): Promise<BranchAddresses> {
  try {
    const res = await fetch('/api/branch-address', { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return { secure: null, setup: null, mode: 'lan' };
}

/**
 * Whether this browser can open the console securely: an https request either completes or fails. On the LAN that
 * means the branch certificate is trusted; with Tailscale it means the phone is connected to the branch tailnet.
 * Opaque (no-cors) is enough; only success or failure matters.
 */
export async function trustsBranchCertificate(origin: string) {
  try {
    await fetch(`${origin}/setup?check=${Date.now()}`, { mode: 'no-cors', cache: 'no-store' });
    return true;
  } catch {
    return false; // untrusted certificate, or not on the branch Wi-Fi
  }
}
