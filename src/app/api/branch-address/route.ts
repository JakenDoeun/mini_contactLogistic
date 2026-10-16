import { branchAddresses } from '@/lib/branch-address';
import { branchOrigin } from '@/lib/tailscale';

// Public on purpose: the phone Setup page (open, no data) shows these addresses, and the live HTTPS self-check in
// Settings opens this route without a session. It returns only the branch's own addresses.
export async function GET() {
  const { origin } = await branchOrigin();
  return Response.json(branchAddresses(origin), { headers: { 'Cache-Control': 'no-store' } });
}
