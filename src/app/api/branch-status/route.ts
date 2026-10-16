import { tailscaleReadiness } from '@/lib/tailscale';
import { withSession } from '@/server/auth/guard';

// Console only (signed-in staff). Measured fresh on every call.
export const GET = withSession(async () => {
  // shortcut: assumes the app's port is PORT or 3000; it only appears in the suggested Serve command.
  return Response.json(await tailscaleReadiness(process.env.PORT || '3000'), { headers: { 'Cache-Control': 'no-store' } });
});
