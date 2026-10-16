# Migration log: Caddy LAN HTTPS → Tailscale HTTPS

Working record of the migration on this computer. Guide for any installation: `docs/deploy-tailscale.md`.

## Status

| Phase | State | Date |
|---|---|---|
| 1. Audit and diagnose | Done | 2026-10-12 |
| 2. Prepare (backups, config, app support, docs) | **Done** | 2026-10-12 |
| 3. Tailscale Serve | **Done**: serving `https://spacek4k.tailc4ca3f.ts.net`, tailnet only | 2026-10-12 |
| 4. Verify | **Done**: phone camera scan over Tailscale owner-confirmed PASS; Settings 7/7 | 2026-10-16 |
| 5. Retire Caddy setup | **Done** (see Phase 5 below). Caddy stopped and not started by anything; binary, config, data and certificates kept | 2026-10-16 |
| 6. Portable deployment scripts | Docs done; start/stop/health-check scripts not written | |

## Phase 1 findings (2026-10-12)

- **Root cause of the QR/setup failure (verified with requests):** Caddy was running with `BRANCH_IP=172.20.10.3` (a phone hotspot address)
  while the laptop was on `192.168.1.10`. The QR pointed at `http://192.168.1.10:8080/setup`; Caddy had no site for that address, redirected
  to https, and failed the TLS handshake (no certificate for `192.168.1.10`). The laptop has since moved back to `172.20.10.3`: the LAN
  address keeps changing, which is the underlying problem.
- That Caddy was a temporary debug process from a scratch config, not a service; it has since been stopped. There are no startup scripts for
  Caddy or the app. No other feature depends on Caddy.
- The app ran as `next dev` on all interfaces (`*:3000`). No database: sample data in the browser. No login.
- Tailscale 1.102.3 installed and signed in as `spacek4k.tailc4ca3f.ts.net`, MagicDNS on, HTTPS Certificates **not enabled**, no Serve config,
  no operator user. It was offline during the audit (no internet) and is online since.

## Backups

`~/campus-branch-backup-2026-10-12/` (owner-only permissions; `SHA256SUMS` lists every file):
`Caddyfile`, the running debug Caddyfile, `local-https.md`, Caddy's `pki` folder (**includes private keys: keep private, never package**),
and the address/status/setup/settings source files as they were before Phase 2 (`app-src-before/` and the loose `.ts` files).

## Phase 2 changes

| File | Change |
|---|---|
| `src/lib/branch-address.ts` | `BranchAddresses` gains `mode` (`tailscale` / `lan`). New `canonicalOrigin()` validates `BRANCH_URL`. A configured origin wins; otherwise the unchanged LAN logic. |
| `src/lib/tailscale.ts` (new) | Read-only: `tailscale status --json` and `tailscale serve status --json` through the local CLI (`TAILSCALE_CLI` overrides the path). `branchOrigin()`: `BRANCH_URL`, else this machine's name once Serve forwards it, else none. Funnel is detected and never used. |
| `src/app/api/branch-address/route.ts` | Uses `branchOrigin()` first, Caddy addresses otherwise. |
| `src/app/api/branch-status/route.ts` | Adds `tailscale` and `origin` to the readiness data. |
| `src/components/settings/branch-readiness.tsx` | "Ready for phones?" shows Tailscale, HTTPS certificates, Serve and the phone address first; the Caddy rows stay under "Legacy LAN setup". |
| `src/components/settings/phone-setup-card.tsx` | Tailscale wording and steps when in Tailscale mode; LAN wording unchanged. |
| `src/components/setup/phone-setup.tsx` | Tailscale mode: install/sign in/turn on, no certificate step; *Check my phone* tests that the address opens. LAN mode unchanged. |
| `src/lib/branch-address.test.ts`, `src/lib/tailscale.test.ts` | Tests for the configured origin, `BRANCH_URL` validation, status and Serve parsing. |
| `deploy/branch.env.example` (new) | Per-machine settings template. |
| `docs/deploy-tailscale.md`, this file (new) | Guide and log. |

Not changed: `deploy/Caddyfile`, `docs/local-https.md`, Caddy's certificates, `/branch-ca.crt`, `next.config.ts`, any service.

**Behaviour today:** no `BRANCH_URL`, no Serve, so the app is in **LAN mode exactly as before**. The Tailscale paths switch on only when
`BRANCH_URL` is set or Serve forwards to the app.

## Phase 3 (2026-10-12)

Prerequisites confirmed first: internet up, Tailscale online, MagicDNS on, HTTPS Certificates on (`CertDomains` lists this name),
operator set to `k4k` by the user (`sudo tailscale set --operator=$USER`).

| Change | Detail | Undo |
|---|---|---|
| `package.json` `dev` script | `next dev` → `next dev -H 127.0.0.1 -p 3000`: the app no longer listens on the LAN | Restore from the backup folder |
| `next.config.ts` | `allowedDevOrigins` = host of `BRANCH_URL`, else this computer's own Tailscale name, read at start-up. Nothing hardcoded | Restore from the backup folder |
| Dev server restarted | The user's `npm run dev` (all interfaces) was stopped and started again on 127.0.0.1 | — |
| `tailscale serve --bg 3000` | `https://spacek4k.tailc4ca3f.ts.net` → `http://127.0.0.1:3000`, tailnet only, kept across restarts | `tailscale serve reset` |
| Settings wording | Legacy Caddy row says "Kept for rollback" instead of an error while the Tailscale address is in use | — |

Backups of `package.json` and `next.config.ts` from before this phase are in the backup folder.

**Verified from this computer:**
- Certificate: Let's Encrypt, CN and SAN `spacek4k.tailc4ca3f.ts.net`, valid Oct 12 2026 – Jan 10 2027, trusted by the system store (no `-k`).
- `tailscale serve status`: tailnet only; Funnel off.
- Listeners: the app only on `127.0.0.1:3000`; port 443 only on the Tailscale addresses. `172.20.10.3:3000` and `:443` are refused from the LAN.
- All routes return 200 over the Tailscale address: `/dashboard`, `/parcels`, `/scan`, `/import-arrivals`, `/notifications`, `/settings`, `/setup`, both APIs, `/branch-ca.crt`; `/` redirects as before.
- `/api/branch-address` → mode `tailscale`; the Settings QR encodes `https://spacek4k.tailc4ca3f.ts.net/setup`.
- In Chrome (desktop, and phone-sized with an iPhone user agent), without ignoring certificate errors: Settings readiness all green;
  `/setup` shows "This phone is ready"; `/scan` is a secure context and `getUserMedia` succeeds with Chrome's *fake* camera; the scanner
  dialog opens. No page errors. No dev-origin warnings in the server log.

**Not verified (needs a real phone or a restart):** QR scan with the phone camera; Tailscale on the phone; real camera permission and a
real barcode read; mobile data vs branch Wi-Fi; refusal for a device outside the tailnet or not allowed by its rules; app and Serve coming
back after a reboot.

**Known gap:** the app now runs as a background process of the coding session. It stops when that session ends. Run it yourself with
`npm run dev` (now localhost-only), or as a service later (Phase 6).

## Certificate diagnostics (2026-10-12)

No certificate files: Serve provisions and renews them (`docs/deploy-tailscale.md` › Certificates are automatic). Settings now measures
readiness instead of only reading configuration: `src/lib/tailscale.ts` adds MagicDNS, a live HTTPS self-check (`probeHttps`: resolves the
name, completes a trusted TLS handshake, confirms the answer comes from this app, reads issuer and expiry) and `diagnoseTailscale`, one check
per prerequisite with its fix. `src/app/api/branch-status/route.ts` measures fresh on every *Check again*. Tests cover every failure path;
the live run passes all seven checks (Let's Encrypt, 89 days left). Real failures were also seen classified correctly: unknown name → dns,
certificate for another name → tls, nothing listening → refused, app stopped behind Serve → HTTP 502.

## Phase 5: Caddy retired (2026-10-16, owner approval)

Checked first, read-only: Caddy (`~/.local/bin/caddy` v2.11.7, a personal binary) had **no** system or user service,
cron entry, autostart or shell-profile line, no special permissions, and was **not running**; nothing listened on its
ports (8080, 8443, admin 2019). Its last saved config (`~/.config/caddy/autosave.json`) served only the old Campus
Branch LAN address `172.20.10.3` on 8080/8443, forwarding to `127.0.0.1:3000` (this app). Its local CA is not in the
system trust store (the only extra CA there is an unrelated mkcert one, left alone). Port 443 on the Tailscale address
belongs to Tailscale Serve. Conclusion: nothing besides Campus Branch's old LAN setup depended on Caddy, so there was
nothing to stop or disable.

Kept untouched for rollback: the Caddy binary, `~/.config/caddy/`, `~/.local/share/caddy/` (incl. its CA and
certificates), `deploy/Caddyfile`, `docs/local-https.md`, and `~/campus-branch-backup-2026-10-12/` (all 17 files match
`SHA256SUMS`; only the list's own line differs, recorded while it was being written).

Removed from the app: the LAN address mode (`src/lib/branch-address.ts`), Caddy's status and CA reader
(`src/lib/branch-ca.ts`), the `/branch-ca.crt` download, the legacy rows in Settings › Ready for phones?, the
certificate-install steps and `?auto` redirect on `/setup`, the LAN wording on the Settings phone card, and
`CADDY_CA_DIR` from `deploy/branch.env.example`. Phones that installed the "Caddy Local Authority" profile can remove it
(iPhone: Settings › General › VPN & Device Management; Android: Settings › Security › Credentials); it is no longer used.

## Rollback

- Before Phase 3: nothing to undo at runtime. To restore the Phase 2 source files, copy them back from the backup folder.
- After Phase 3: `tailscale serve reset`, remove `BRANCH_URL` from `.env.local` if set, restore `package.json` and `next.config.ts` from the
  backup folder if wanted, restart the app.
- After Phase 5: `git revert` the Caddy-retirement commit to bring the LAN mode, `/branch-ca.crt` and the legacy Settings rows back,
  rebuild, then start Caddy with the current IP, e.g. `BRANCH_IP=<ip> HTTP_PORT=8080 HTTPS_PORT=8443 caddy run --config deploy/Caddyfile`
  (`docs/local-https.md`). Sign-in over a LAN address also needs `BRANCH_URL` set to it (`docs/phase2-login.md`).

## Not production-ready (do not rely on these yet)

- **Data:** sample data in browser memory; no database, nothing persists across reloads.
- **Login:** none yet. A simple staff login is planned as separate work before real customer data.
- **QR setup over Tailscale:** implemented, not yet tested on a phone.
- **SMS:** simulated; no gateway is connected.
