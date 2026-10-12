import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// Server only. The public root certificate of Caddy's local CA, for phones to trust. Only
// root.crt is ever read; root.key never leaves the office computer.

/** Caddy's default data folder for the account it runs as (caddyserver.com/docs/conventions). */
export function caDir() {
  if (process.env.CADDY_CA_DIR) return process.env.CADDY_CA_DIR;
  const home = os.homedir();
  const data =
    process.platform === 'win32'
      ? path.join(process.env.AppData ?? path.join(home, 'AppData', 'Roaming'), 'Caddy')
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'Caddy')
        : path.join(process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'caddy');
  return path.join(data, 'pki', 'authorities', 'local');
}

/** root.crt, or null when Caddy has not created it yet (or runs as another account). */
export async function readRootCert(): Promise<Buffer | null> {
  try {
    return await readFile(path.join(caDir(), 'root.crt'));
  } catch {
    return null;
  }
}

export type BranchStatus = {
  caddy: { running: boolean; httpPort: number | null; httpsPort: number | null };
  certificate: { ready: true; name: string; fingerprint: string; expires: string } | { ready: false; folder: string };
};

/** Asks Caddy's admin API, which only listens on this computer. Its config also holds the ports in use. */
export function caddyStatus(): Promise<BranchStatus['caddy']> {
  const stopped = { running: false, httpPort: null, httpsPort: null };
  // node:http, not fetch: Caddy refuses fetch's browser-style Sec-Fetch-Mode header (its CSRF guard).
  // shortcut: assumes the default admin address; read CADDY_ADMIN here if it is ever changed.
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:2019/config/apps/http', { timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(stopped);
        try {
          const app = JSON.parse(body);
          resolve({ running: true, httpPort: app?.http_port ?? 80, httpsPort: app?.https_port ?? 443 });
        } catch {
          resolve(stopped);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(stopped));
  });
}

export async function branchStatus(): Promise<BranchStatus> {
  const [caddy, pem] = await Promise.all([caddyStatus(), readRootCert()]);
  if (!pem) return { caddy, certificate: { ready: false, folder: caDir() } };
  try {
    const cert = new X509Certificate(pem);
    return {
      caddy,
      certificate: {
        ready: true,
        name: cert.subject.match(/CN=(.+)/)?.[1] ?? cert.subject,
        fingerprint: cert.fingerprint256,
        expires: new Date(cert.validTo).toISOString(),
      },
    };
  } catch {
    return { caddy, certificate: { ready: false, folder: caDir() } }; // unreadable file: phones could not install it either
  }
}
