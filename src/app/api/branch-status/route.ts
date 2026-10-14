import { branchStatus } from '@/lib/branch-ca';
import { tailscaleReadiness } from '@/lib/tailscale';
import { withSession } from '@/server/auth/guard';

// Console only (signed-in staff): deploy/Caddyfile does not expose this on plain http. Measured fresh on every call.
export const GET = withSession(async () => {
  // shortcut: assumes the app's port is PORT or 3000; it only appears in the suggested Serve command.
  const [legacy, tailscale] = await Promise.all([branchStatus(), tailscaleReadiness(process.env.PORT || '3000')]);
  return Response.json({ ...legacy, ...tailscale }, { headers: { 'Cache-Control': 'no-store' } });
});
