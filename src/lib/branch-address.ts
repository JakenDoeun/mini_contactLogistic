// Where phones reach the console: one configured https origin (BRANCH_URL, or this machine's Tailscale Serve name)
// with a publicly trusted certificate. No IP, no port, no certificate to install on phones (docs/deploy-tailscale.md).
// The earlier Caddy-by-IP setup was retired on 2026-10-16 (docs/migration-tailscale.md).

export type BranchAddresses = { secure: string | null; setup: string | null };

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

/** The phone addresses for a configured origin; none until Tailscale Serve shares the app or BRANCH_URL is set. */
export const branchAddresses = (origin: string | null): BranchAddresses =>
  origin ? { secure: origin, setup: `${origin}/setup` } : { secure: null, setup: null };

/** The addresses as seen by this browser, from the server (src/app/api/branch-address). */
export async function fetchBranchAddresses(): Promise<BranchAddresses> {
  try {
    const res = await fetch('/api/branch-address', { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return { secure: null, setup: null };
}

/**
 * Whether this browser can open the console securely: an https request either completes or fails, so success means
 * the phone is connected to the branch tailnet. Opaque (no-cors) is enough; only success or failure matters.
 */
export async function reachesBranch(origin: string) {
  try {
    await fetch(`${origin}/setup?check=${Date.now()}`, { mode: 'no-cors', cache: 'no-store' });
    return true;
  } catch {
    return false; // Tailscale off, not approved, or the office computer is off
  }
}
