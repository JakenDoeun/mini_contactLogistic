import { branchStatus } from '@/lib/branch-ca';
import { tailscaleReadiness } from '@/lib/tailscale';

// Console only: deploy/Caddyfile does not expose this on plain http. Measured fresh on every call ("Check again").
export async function GET() {
  // shortcut: assumes the app's port is PORT or 3000; it only appears in the suggested Serve command.
  const [legacy, tailscale] = await Promise.all([branchStatus(), tailscaleReadiness(process.env.PORT || '3000')]);
  return Response.json({ ...legacy, ...tailscale }, { headers: { 'Cache-Control': 'no-store' } });
}
