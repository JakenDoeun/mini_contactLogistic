import { branchAddresses } from '@/lib/branch-address';
import { caddyStatus } from '@/lib/branch-ca';
import { branchOrigin } from '@/lib/tailscale';

export async function GET(req: Request) {
  // A configured https origin (BRANCH_URL or Tailscale Serve) first; otherwise the legacy Caddy LAN addresses.
  const { origin } = await branchOrigin();
  const caddy = origin ? undefined : await caddyStatus();
  return Response.json(branchAddresses(req.headers, caddy?.running ? caddy : undefined, origin), { headers: { 'Cache-Control': 'no-store' } });
}
