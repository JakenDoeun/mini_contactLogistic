import type { NextConfig } from 'next';
import { execFileSync } from 'node:child_process';

/**
 * The tailnet name the dev server may be opened through behind Tailscale Serve, and nothing wider. Worked out on
 * each machine when the app starts: the host of BRANCH_URL, else this computer's own Tailscale name. Another
 * computer or tailnet gets its own name the same way. Only `next dev` reads this; `next start` ignores it.
 */
function tailnetDevOrigins(): string[] {
  if (process.env.BRANCH_URL) {
    try {
      return [new URL(process.env.BRANCH_URL).hostname];
    } catch {
      return [];
    }
  }
  try {
    const out = execFileSync(process.env.TAILSCALE_CLI || 'tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    const name = (JSON.parse(out) as { Self?: { DNSName?: string } }).Self?.DNSName?.replace(/\.$/, '');
    return name ? [name] : [];
  } catch {
    return []; // no Tailscale here: the dev server is only used on localhost
  }
}

const nextConfig: NextConfig = { allowedDevOrigins: tailnetDevOrigins() };

export default nextConfig;
