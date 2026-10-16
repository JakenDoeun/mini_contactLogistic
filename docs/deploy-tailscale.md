# Branch deployment with Tailscale HTTPS

How staff phones reach the Campus Branch console securely, on any computer and any tailnet, without a fixed LAN IP and without installing a
certificate on each phone. It replaces the Caddy-by-IP setup in `docs/local-https.md` **once verified**; until then both exist side by side.
Migration status and rollback: `docs/migration-tailscale.md`.

> **Status (2026-10-12): live on spacek4k for testing, not yet confirmed on a phone.** Serve runs and the computer-side checks pass
> (`docs/migration-tailscale.md`). The app still uses sample data in the browser, has no staff login yet, and sends no real SMS.

## How it works

```
staff phone (Tailscale app, signed in, approved)
   │  https://<computer>.<tailnet>.ts.net      ← publicly trusted certificate, issued by Tailscale for this name
   ▼
office computer: Tailscale Serve (tailnet only, never Funnel)
   │  http://127.0.0.1:3000                    ← the app listens on this computer only
   ▼
Next.js app (npm run start:lan)
```

- The address is the computer's **MagicDNS name**, so it never changes when the Wi-Fi or IP changes.
- The certificate is a normal trusted one, so the phone camera works (browsers allow the camera only on https) with nothing to install.
- Only devices in **this branch's tailnet** that the tailnet's access rules allow can open it. It is not on the internet.
- Each installation finds its own name: from `BRANCH_URL` in its `.env.local`, or read from its own local Tailscale. No hostname is in the source code.

## Certificates are automatic

There are no certificate files to create, copy, install or renew. Tailscale Serve asks Let's Encrypt for a certificate for the
computer's own `*.ts.net` name the first time the address is opened, keeps it inside Tailscale, and renews it by itself before it
expires (the certificates last about 90 days). The only conditions: HTTPS Certificates are enabled for the tailnet, and the computer
is online now and then so renewal can happen. Settings › *Live HTTPS check* shows the issuer and days left, and warns when fewer
than 14 days remain (which means renewal is not happening: usually the computer has been offline).

The old Caddy setup's certificate (`/branch-ca.crt`, `docs/local-https.md`) is unrelated and only kept for rollback.

## One-time prerequisites per tailnet

Done once by a tailnet admin, for every branch tailnet:

1. **MagicDNS** on: admin console › DNS › Enable MagicDNS.
2. **HTTPS Certificates** on: admin console › DNS › HTTPS Certificates › Enable.
3. The office computer **signed in and approved**, and **online**.
4. **Serve** configured on the office computer, once: `tailscale serve --bg <app port>` (3000 by default).

Settings › *Ready for phones?* checks each of these on the computer itself and names the fix for anything missing.

## What every installation needs

| Item | Who | Notes |
|---|---|---|
| A Tailscale tailnet for the branch | tailnet admin | One per branch, or a shared one with access rules per branch. |
| **MagicDNS** on | tailnet admin | Admin console › DNS. |
| **HTTPS Certificates** on | tailnet admin | Admin console › DNS › HTTPS Certificates. Publishes machine names in public certificate logs (Certificate Transparency); pick computer names accordingly. |
| Tailscale on the office computer, signed in, approved | admin + computer | Windows: tailscale.com/download. Runs as a service and starts with the computer. |
| Node.js 20+ and the app | computer | Built in its own folder (see below). |
| Tailscale app on each staff phone, signed in, approved | admin + staff | iPhone: App Store. Android: Google Play. |
| Access rule so only staff devices reach the office computer | tailnet admin | Example below. |

## Set up a new installation (Windows first)

1. **Tailscale.** Install it, sign in to the branch tailnet, and have the admin approve the computer. Check in a terminal:
   `tailscale status` shows this computer online with a name like `office-pc.your-tailnet.ts.net`.
2. **The app.** Copy the app folder to the computer (without `node_modules`, `.next` or any `.env*` file), then in that folder:
   `npm ci` and `npm run build`. Build in the folder the app will run from, while no dev server uses it.
3. **Configuration.** Copy `deploy/branch.env.example` to `.env.local` in the app folder. Set `BRANCH_URL=https://<this computer's name>`,
   or leave it unset to have it read automatically once Serve runs.
4. **Start the app** so it listens on this computer only: `npm run start:lan` (127.0.0.1:3000). Do not open port 3000 in the firewall.
   To start it with Windows: Task Scheduler › Create Task › "At log on" › Action `cmd /c npm run start:lan`, "Start in" = the app folder.
5. **Share it on the tailnet** (once, as an administrator):
   `tailscale serve --bg 3000`
   `--bg` keeps the setting across restarts. Check with `tailscale serve status`: it lists `https://<name>` → `http://127.0.0.1:3000`.
   **Never run `tailscale funnel`**: it would put the app on the internet. Settings flags Funnel in red if it is ever on.
6. **Check.** Open **Settings** › *Ready for phones?*: Tailscale *Connected*, HTTPS certificates *Enabled*, Tailscale Serve *Sharing the app*,
   Phone address *Set by BRANCH_URL* or *Automatic*. The QR code below it now points to `https://<name>/setup`.
7. **Phones.** Each phone: install Tailscale, sign in, get approved, turn it on, scan the QR code, tap **Check my phone**, then allow the camera
   when Scan Parcel asks.

### Other systems

| | Windows | Linux | macOS |
|---|---|---|---|
| `tailscale` CLI | On PATH after install; else set `TAILSCALE_CLI=C:\Program Files\Tailscale\tailscale.exe` | On PATH | Set `TAILSCALE_CLI=/Applications/Tailscale.app/Contents/MacOS/Tailscale` (App Store/standalone app) |
| Running `tailscale serve` | Administrator terminal | `sudo`, or once `sudo tailscale set --operator=$USER` | Usually no sudo |
| Start the app at boot | Task Scheduler | systemd unit with `WorkingDirectory` = app folder, `ExecStart=npm run start:lan` | launchd agent |

## This computer (spacek4k, Linux)

Done on 2026-10-12 (details in `docs/migration-tailscale.md`): HTTPS Certificates on, operator set, `tailscale serve --bg 3000` running.
`npm run dev` now listens on 127.0.0.1 only, and `next.config.ts` allows the dev server to be opened through this computer's own
Tailscale name (worked out at start-up, so other computers get theirs). Remaining: the phone tests below.

## Access control (example, adapt in the admin console)

Tag the office computer and allow only staff to reach its https port. In the tailnet policy file:

```json
{
  "tagOwners": { "tag:branch-office": ["autogroup:admin"] },
  "groups": { "group:branch-staff": ["staff-phone-user@example.com"] },
  "grants": [{ "src": ["group:branch-staff"], "dst": ["tag:branch-office"], "ip": ["tcp:443"] }]
}
```

Also consider **Device approval** (admin console › Settings › Device management) so a new phone cannot join until approved. Adding rules
like these replaces the default allow-all policy: check that admins keep the access they need before saving.

## Verification checklist (Phase 4)

| Test | How | Can be automated here? |
|---|---|---|
| App opens at `https://<name>` | Browser on the computer or a tailnet device | Yes, once Serve runs |
| QR opens setup on a phone | Phone with Tailscale on, Camera app | Manual |
| Camera permission and real scan | Scan Parcel on the phone, a printed barcode | Manual |
| Works on branch Wi-Fi and on mobile data | Repeat on both | Manual |
| Survives a restart | Restart; app and Serve come back (`tailscale serve status`) | Manual |
| Unauthorized device refused | A device not in the tailnet, or not allowed by the rules, cannot open the name | Manual |
| Existing routes intact | Dashboard, Parcels, Scan, Import, Notifications, Settings load | Yes |

## Troubleshooting

**"Server not found" in the computer's browsers, while phones open the address** (seen 2026-10-16 on spacek4k):
another VPN or DNS filter owns the computer's DNS and does not know `*.ts.net` names. On spacek4k it was Cloudflare
WARP: `/etc/resolv.conf` points at WARP's proxy (`127.0.2.2`), so `getent hosts <name>` prints nothing although
`resolvectl query <name>` works. Do not repoint `/etc/resolv.conf` (WARP owns it). Either add the name to the hosts
file (`100.x.y.z <name>`; `tailscale ip -4` shows the address; Windows: `C:\Windows\System32\drivers\etc\hosts`), add
`ts.net` to the other VPN's local-domain/split-DNS exceptions, or turn that VPN off. Settings' Live HTTPS check is not
affected: it connects to the Tailscale address directly. On phones only one VPN can be active: Tailscale must be the
one that is on.

Start with **Settings › Ready for phones? › Check again**. Each line is measured on the computer when you press it, and the first
failing line is usually the one to fix.

| Settings line | Shows | Fix |
|---|---|---|
| Tailscale on this computer | Needs fixing: not found | Install Tailscale, sign in. Unusual install folder: set `TAILSCALE_CLI` in `.env.local`. |
| | Waiting for approval / Signed out / Turned off | Approve in admin console › Machines / sign in / `tailscale up`. |
| Connected | Needs fixing | The computer is offline. Fix its internet; phones cannot connect meanwhile and certificates cannot renew. |
| MagicDNS name | Needs fixing | Admin console › DNS › Enable MagicDNS. |
| HTTPS certificates | Needs fixing | Admin console › DNS › HTTPS Certificates › Enable. |
| Tailscale Serve | Not sharing | `tailscale serve --bg 3000` (Linux: needs the operator, see below; Windows: administrator terminal). |
| | Funnel is on | `tailscale serve reset`, then `tailscale serve --bg 3000`. Never use Funnel. |
| Live HTTPS check | Waiting | Runs once the lines above pass. |
| | Certificate missing or not trusted yet | The first certificate can take up to a minute after setup: check again. |
| | Serve cannot reach the app (502) | Start the app (`npm run dev` / `npm run start:lan`); if it uses another port, `tailscale serve reset` then `tailscale serve --bg <port>`. |
| | Name does not resolve | MagicDNS off, or this computer ignores Tailscale DNS: `tailscale set --accept-dns=true`. |
| | Fewer than 14 days left | Renewal is not happening: keep the computer online; restart Tailscale if it persists. |
| Phone address | BRANCH_URL ignored / points to another computer | Fix or remove `BRANCH_URL` in `.env.local` (often copied from another branch), restart the app. |

When the **app itself is not running**, Settings cannot open at all and phones get a plain *502* page from Tailscale: start the app.
When the **computer is off or offline**, phones cannot reach the name at all.

On a phone: Tailscale app on and *Connected*? Phone approved? Access rules allow it? Camera blocked: browser site settings › Camera ›
Allow, on the `https://` address.

Linux only: `tailscale serve` needs root unless an operator is set once: `sudo tailscale set --operator=$USER`.

## Never in a deployment package

`.env.local`, `.next`, `node_modules`, Caddy's `pki` folder, Tailscale state or auth keys, backups, and any customer data. Each branch keeps
its own configuration, data and tailnet access.

## Rollback

`tailscale serve reset`, remove `BRANCH_URL` from `.env.local`, restart the app. Phones then get the legacy LAN setup (`docs/local-https.md`)
again; Caddy and its certificates were never changed.
