// Server only. Reads this machine's own Tailscale state through the local `tailscale` CLI, so every installation finds
// its own hostname and tailnet: nothing here is specific to one computer. Read-only: it never changes Tailscale.
import { execFile } from 'node:child_process';
import https from 'node:https';
import type { TLSSocket } from 'node:tls';
import { canonicalOrigin } from './branch-address.ts';

export type TailscaleStatus =
  | { installed: false }
  | {
      installed: true;
      /** BackendState: Running, NeedsLogin, Stopped, NeedsMachineAuth (waiting for admin approval), … */
      state: string;
      /** Reaches the coordination server right now. False when the computer is offline. */
      online: boolean;
      /** This machine's MagicDNS name, e.g. office-pc.example-tailnet.ts.net. */
      hostname: string | null;
      /** This machine's Tailscale IPv4 address, e.g. 100.x.y.z. */
      ip: string | null;
      /** MagicDNS is on for the tailnet: phones find the computer by name. */
      magicDNS: boolean;
      /** HTTPS certificates are enabled for the tailnet and cover this hostname. */
      httpsCertificates: boolean;
      /** What Tailscale Serve sends https://hostname to, if anything. */
      serveTarget: string | null;
      /** Funnel would publish the app to the internet. Never wanted here: reported as a problem. */
      funnel: boolean;
    };

/** Parses `tailscale status --json`. */
export function parseStatus(json: unknown) {
  const d = (json ?? {}) as {
    BackendState?: string;
    Self?: { DNSName?: string; Online?: boolean; TailscaleIPs?: string[] };
    CertDomains?: string[] | null;
    CurrentTailnet?: { MagicDNSEnabled?: boolean } | null;
  };
  const hostname = d.Self?.DNSName?.replace(/\.$/, '') || null;
  return {
    state: d.BackendState ?? 'Unknown',
    online: !!d.Self?.Online,
    hostname,
    ip: d.Self?.TailscaleIPs?.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? null,
    magicDNS: !!d.CurrentTailnet?.MagicDNSEnabled,
    httpsCertificates: !!hostname && (d.CertDomains ?? []).includes(hostname),
  };
}

/** Parses `tailscale serve status --json` for the https root of this hostname. */
export function parseServe(json: unknown, hostname: string | null) {
  const d = (json ?? {}) as {
    Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
    AllowFunnel?: Record<string, boolean>;
  };
  const key = hostname && `${hostname}:443`;
  return {
    serveTarget: (key && d.Web?.[key]?.Handlers?.['/']?.Proxy) || null,
    funnel: Object.values(d.AllowFunnel ?? {}).some(Boolean),
  };
}

const CLI = () => process.env.TAILSCALE_CLI || 'tailscale'; // Windows: on PATH after install; set TAILSCALE_CLI if not

function run(args: string[]): Promise<{ ok: true; out: string } | { ok: false; missing: boolean }> {
  return new Promise((resolve) => {
    // Runs the external tailscale CLI, not a project file, so Turbopack need not trace the project.
    execFile(/*turbopackIgnore: true*/ CLI(), args, { timeout: 3000, windowsHide: true }, (err, out) => {
      if (err) resolve({ ok: false, missing: (err as NodeJS.ErrnoException).code === 'ENOENT' });
      else resolve({ ok: true, out });
    });
  });
}

let cached: { at: number; value: TailscaleStatus } | null = null;

/** Cached for a few seconds: the address API asks on every phone page load. */
export async function tailscaleStatus(): Promise<TailscaleStatus> {
  if (cached && Date.now() - cached.at < 5000) return cached.value;
  const status = await run(['status', '--json']);
  let value: TailscaleStatus;
  if (!status.ok && status.missing) value = { installed: false };
  else {
    let parsed = { state: 'Unavailable', online: false, hostname: null as string | null, ip: null as string | null, magicDNS: false, httpsCertificates: false };
    try {
      if (status.ok) parsed = parseStatus(JSON.parse(status.out));
    } catch {}
    const serve = await run(['serve', 'status', '--json']);
    let s = { serveTarget: null as string | null, funnel: false };
    try {
      if (serve.ok) s = parseServe(JSON.parse(serve.out || '{}'), parsed.hostname);
    } catch {}
    value = { installed: true, ...parsed, ...s };
  }
  cached = { at: Date.now(), value };
  return value;
}

export type BranchOrigin = {
  origin: string | null;
  source: 'BRANCH_URL' | 'tailscale' | null;
  /** BRANCH_URL is set but is not a bare https origin; it is ignored. */
  invalidBranchUrl?: string;
};

/**
 * The one https address phones use. BRANCH_URL wins; otherwise this machine's Tailscale name, but only once
 * Tailscale Serve actually forwards it (before that the name would not answer). Neither: no phone address yet.
 */
export async function branchOrigin(): Promise<BranchOrigin> {
  const raw = process.env.BRANCH_URL;
  if (raw?.trim()) {
    const origin = canonicalOrigin(raw);
    return origin ? { origin, source: 'BRANCH_URL' } : { origin: null, source: null, invalidBranchUrl: raw };
  }
  const ts = await tailscaleStatus();
  if (ts.installed && ts.hostname && ts.serveTarget && !ts.funnel) return { origin: `https://${ts.hostname}`, source: 'tailscale' };
  return { origin: null, source: null };
}

// ---- Live self-check and diagnosis -------------------------------------------------------------------------------

/** What this computer sees when it opens its own https address, the same way a phone would. */
export type HttpsProbe =
  | { ok: true; status: number; thisApp: boolean; issuer: string; validTo: string }
  | { ok: false; reason: 'dns' | 'refused' | 'tls' | 'timeout' | 'other'; message: string };

/**
 * A DNS lookup that always answers `ip`. Phones reach the computer through their own Tailscale app, so the probe goes
 * to this computer's Tailscale address directly instead of trusting this computer's DNS setup, which phones never use.
 */
export const pinnedLookup =
  (ip: string) =>
  (_host: string, options: { all?: boolean }, cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void) =>
    options?.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4);

/**
 * Opens https://hostname/api/branch-address with normal certificate checks. Proves, end to end, that Serve answers,
 * the certificate is valid and trusted for the name, and the request reaches this app. With `ip`, the name is not
 * looked up in this computer's DNS (see pinnedLookup); the certificate is still checked against the name.
 */
/** The probe's request reached this app: /api/branch-address answers with its phone addresses (branchAddresses). */
export function answeredByThisApp(status: number, body: string) {
  try {
    return status === 200 && 'setup' in JSON.parse(body);
  } catch {
    return false;
  }
}

export function probeHttps(hostname: string, ip?: string | null): Promise<HttpsProbe> {
  return new Promise((resolve) => {
    const lookup = ip ? { lookup: pinnedLookup(ip) as never } : {};
    const req = https.get({ host: hostname, port: 443, path: '/api/branch-address', servername: hostname, timeout: 8000, ...lookup }, (res) => {
      const cert = (res.socket as TLSSocket).getPeerCertificate();
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () =>
        resolve({
          ok: true,
          status: res.statusCode ?? 0,
          thisApp: answeredByThisApp(res.statusCode ?? 0, body),
          issuer: [cert?.issuer?.O, cert?.issuer?.CN].filter(Boolean).join(' '),
          validTo: cert?.valid_to ? new Date(cert.valid_to).toISOString() : '',
        }),
      );
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('No answer within 8 seconds'), { code: 'ETIMEDOUT' })));
    req.on('error', (e: NodeJS.ErrnoException) => {
      const code = e.code ?? '';
      const reason =
        code === 'ENOTFOUND' || code === 'EAI_AGAIN'
          ? 'dns'
          : code === 'ECONNREFUSED' || code === 'ECONNRESET'
            ? 'refused'
            : code === 'ETIMEDOUT'
              ? 'timeout'
              : /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/i.test(code + e.message)
                ? 'tls'
                : 'other';
      resolve({ ok: false, reason, message: `${code} ${e.message}`.trim() });
    });
  });
}

export type CheckState = 'ok' | 'warn' | 'fail' | 'skip';
export interface Check {
  id: 'tailscale' | 'online' | 'magicdns' | 'certificates' | 'serve' | 'https' | 'address';
  label: string;
  state: CheckState;
  /** What was found. */
  detail: string;
  /** What to do about it, when something is wrong. */
  fix?: string;
}

const RENEW_WARN_DAYS = 14;

/**
 * Turns the diagnostic results into one check per prerequisite, each with a plain next step. Pure, so every
 * failure path is tested without a real tailnet. `appPort` is only used in the suggested Serve command.
 */
export function diagnoseTailscale(
  ts: TailscaleStatus,
  probe: HttpsProbe | null,
  origin: BranchOrigin,
  appPort: string,
  now = new Date(),
): Check[] {
  const serveCmd = `tailscale serve --bg ${appPort}`;
  const checks: Check[] = [];
  const skip = (id: Check['id'], label: string, why: string) => checks.push({ id, label, state: 'skip', detail: why });

  if (!ts.installed) {
    checks.push({
      id: 'tailscale',
      label: 'Tailscale on this computer',
      state: 'fail',
      detail: 'The tailscale command was not found.',
      fix: 'Install Tailscale (tailscale.com/download) and sign in to this branch’s tailnet. If it is installed in an unusual place, set TAILSCALE_CLI in .env.local.',
    });
    return checks;
  }
  const signedIn = ts.state === 'Running';
  checks.push(
    signedIn
      ? { id: 'tailscale', label: 'Tailscale on this computer', state: 'ok', detail: 'Running and signed in.' }
      : {
          id: 'tailscale',
          label: 'Tailscale on this computer',
          state: 'fail',
          detail:
            ts.state === 'NeedsMachineAuth'
              ? 'Signed in, waiting for an admin to approve this computer.'
              : ts.state === 'NeedsLogin'
                ? 'Signed out.'
                : ts.state === 'Stopped'
                  ? 'Turned off.'
                  : `Not ready (${ts.state}).`,
          fix:
            ts.state === 'NeedsMachineAuth'
              ? 'Approve it in the Tailscale admin console › Machines.'
              : ts.state === 'NeedsLogin'
                ? 'Sign in from the Tailscale app, or run: tailscale up'
                : 'Turn Tailscale on from its app, or run: tailscale up',
        },
  );
  if (!signedIn) return checks;

  checks.push(
    ts.online
      ? { id: 'online', label: 'Connected', state: 'ok', detail: 'Reaches Tailscale’s coordination server.' }
      : {
          id: 'online',
          label: 'Connected',
          state: 'fail',
          detail: 'Cannot reach Tailscale’s coordination server: this computer looks offline.',
          fix: 'Check its internet connection. Phones cannot reach the console while it is offline, and certificates cannot renew.',
        },
  );
  checks.push(
    ts.magicDNS && ts.hostname
      ? { id: 'magicdns', label: 'MagicDNS name', state: 'ok', detail: ts.hostname }
      : {
          id: 'magicdns',
          label: 'MagicDNS name',
          state: 'fail',
          detail: 'MagicDNS is off, so phones cannot find this computer by name.',
          fix: 'Tailscale admin console › DNS › Enable MagicDNS (once per tailnet).',
        },
  );
  checks.push(
    ts.httpsCertificates
      ? { id: 'certificates', label: 'HTTPS certificates', state: 'ok', detail: 'Enabled for this tailnet and this name.' }
      : {
          id: 'certificates',
          label: 'HTTPS certificates',
          state: 'fail',
          detail: 'Not enabled for this tailnet, so Serve cannot get a certificate.',
          fix: 'Tailscale admin console › DNS › HTTPS Certificates › Enable (once per tailnet).',
        },
  );

  if (ts.funnel) {
    checks.push({
      id: 'serve',
      label: 'Tailscale Serve',
      state: 'fail',
      detail: 'Funnel is on: the app is published to the internet.',
      fix: `Turn it off now: tailscale serve reset, then share it on the tailnet only: ${serveCmd}`,
    });
  } else if (!ts.serveTarget) {
    checks.push({
      id: 'serve',
      label: 'Tailscale Serve',
      state: 'fail',
      detail: 'Not sharing the app on the tailnet.',
      fix: `Run once on this computer: ${serveCmd}  (kept across restarts; never use funnel)`,
    });
  } else {
    checks.push({ id: 'serve', label: 'Tailscale Serve', state: 'ok', detail: `https://${ts.hostname} → ${ts.serveTarget}, tailnet only.` });
  }

  // The live check is the real proof; it only makes sense once everything before it is in place.
  if (!probe) skip('https', 'Live HTTPS check', 'Runs once the steps above pass.');
  else if (probe.ok && probe.thisApp) {
    const days = probe.validTo ? Math.floor((new Date(probe.validTo).getTime() - now.getTime()) / 86_400_000) : null;
    checks.push({
      id: 'https',
      label: 'Live HTTPS check',
      state: days !== null && days < RENEW_WARN_DAYS ? 'warn' : 'ok',
      detail: `Opened https://${ts.hostname} with a trusted certificate from ${probe.issuer || 'an unknown issuer'}${
        days !== null ? `, valid ${days} more days` : ''
      }. Tailscale renews it automatically.`,
      fix:
        days !== null && days < RENEW_WARN_DAYS
          ? 'Renewal is overdue. Keep this computer online; if it stays this way, restart Tailscale.'
          : undefined,
    });
  } else if (probe.ok) {
    checks.push({
      id: 'https',
      label: 'Live HTTPS check',
      state: 'fail',
      detail:
        probe.status === 502 || probe.status === 503
          ? `The certificate works, but Serve cannot reach the app at ${ts.serveTarget} (HTTP ${probe.status}).`
          : `The certificate works, but the answer did not come from this app (HTTP ${probe.status}).`,
      fix: `Make sure the app is running, then point Serve at its port: tailscale serve reset, then ${serveCmd}`,
    });
  } else {
    const detail = {
      dns: `${ts.hostname} does not resolve on this computer.`,
      refused: 'Nothing answered on port 443.',
      tls: 'The certificate is missing or not trusted yet.',
      timeout: 'No answer within 8 seconds.',
      other: 'The request failed.',
    }[probe.reason];
    const fix = {
      dns: 'Check MagicDNS above, and that this computer uses Tailscale DNS (tailscale set --accept-dns=true).',
      refused: `Serve may have stopped: ${serveCmd}`,
      tls: 'The first certificate can take up to a minute: check again shortly. If it persists, check HTTPS certificates above and that this computer is online.',
      timeout: 'The first request after setup can be slow while the certificate is issued: check again in a minute.',
      other: 'Check the steps above, then check again.',
    }[probe.reason];
    checks.push({ id: 'https', label: 'Live HTTPS check', state: 'fail', detail: `${detail} (${probe.message})`, fix });
  }

  // Which address phones are given.
  if (origin.invalidBranchUrl) {
    checks.push({
      id: 'address',
      label: 'Phone address',
      state: 'fail',
      detail: `BRANCH_URL is “${origin.invalidBranchUrl}”, which is not a bare https address. It is ignored.`,
      fix: `Set BRANCH_URL=https://${ts.hostname ?? 'this-computer.your-tailnet.ts.net'} in .env.local, or remove it to use the automatic name. Restart the app.`,
    });
  } else if (origin.source === 'BRANCH_URL' && ts.hostname && new URL(origin.origin!).hostname !== ts.hostname) {
    checks.push({
      id: 'address',
      label: 'Phone address',
      state: 'warn',
      detail: `BRANCH_URL is ${origin.origin}, but this computer is ${ts.hostname}. Phones will be sent elsewhere.`,
      fix: 'Copied from another installation? Fix or remove BRANCH_URL in .env.local and restart the app.',
    });
  } else if (origin.origin) {
    checks.push({
      id: 'address',
      label: 'Phone address',
      state: 'ok',
      detail: `${origin.origin} (${origin.source === 'BRANCH_URL' ? 'set by BRANCH_URL' : 'found automatically'}).`,
    });
  } else {
    checks.push({
      id: 'address',
      label: 'Phone address',
      state: 'warn',
      detail: 'No Tailscale address yet, so phones have no address to open.',
      fix: 'Fix the failing steps above; the address is picked up automatically once Serve shares the app.',
    });
  }
  return checks;
}

/** Everything the Settings panel needs, measured now. The live check runs only when it can succeed. */
/**
 * When this app cannot read Tailscale's status but knows its address from BRANCH_URL: on Windows, Tailscale answers
 * only the user who signed it in, not the app's own account. The live check then shows what a phone will see.
 */
export function diagnoseByAddress(probe: HttpsProbe, origin: BranchOrigin & { source: 'BRANCH_URL' }, appPort: string, now = new Date()): Check[] {
  const hostname = new URL(origin.origin!).hostname;
  const seen: TailscaleStatus = {
    installed: true, state: 'Running', online: true, hostname, ip: null, magicDNS: true, httpsCertificates: true, serveTarget: 'this app', funnel: false,
  };
  const reached = probe.ok && probe.thisApp;
  return [
    {
      id: 'tailscale',
      label: 'Tailscale on this computer',
      state: reached ? 'ok' : 'warn',
      detail: `Its settings are shown only to the Windows user who signed it in, so the address is checked directly${
        reached ? ' and answers through Tailscale. Funnel cannot be checked from here; never turn it on.' : '.'
      }`,
      fix: reached ? undefined : 'Check the Tailscale icon next to the clock: signed in and connected?',
    },
    ...diagnoseTailscale(seen, probe, origin, appPort, now).filter((c) => c.id === 'https' || c.id === 'address'),
  ];
}

export async function tailscaleReadiness(appPort: string) {
  cached = null; // "Check again" must measure, not repeat
  const [ts, origin] = await Promise.all([tailscaleStatus(), branchOrigin()]);
  if (ts.installed && ts.state === 'Unavailable' && origin.source === 'BRANCH_URL') {
    const probe = await probeHttps(new URL(origin.origin!).hostname);
    return { tailscale: ts, origin, checks: diagnoseByAddress(probe, { ...origin, source: 'BRANCH_URL' }, appPort) };
  }
  const ready = ts.installed && ts.state === 'Running' && ts.hostname && ts.httpsCertificates && ts.serveTarget && !ts.funnel;
  const probe = ready ? await probeHttps(ts.hostname!, ts.ip) : null;
  return { tailscale: ts, origin, checks: diagnoseTailscale(ts, probe, origin, appPort) };
}
