# Local HTTPS for the branch: Caddy, the office computer's IP, and phone setup

> **Retired 2026-10-16.** Phones now use Tailscale HTTPS (`docs/deploy-tailscale.md`); the app no longer has a LAN mode
> or the `/branch-ca.crt` download. Kept as the rollback reference: see `docs/migration-tailscale.md`, "Rollback".

The parcel console runs on the office computer. Staff phones use it over the branch Wi-Fi only.
Nothing is hosted publicly, no domain name is needed, and nothing is reachable from the internet.

Why HTTPS at all: phone browsers only allow the camera on secure pages, meaning `https://` (or
`localhost` on the computer itself). Opening `http://192.168.x.x:3000` on a phone gives the
console without camera scanning. That is a browser rule, and this setup works with it rather
than around it. Typing the tracking code always works, with or without any of this.

```
Staff phone ──https──▶ Caddy :443 on the office PC ──http──▶ Next.js on 127.0.0.1:3000
            ──http───▶ Caddy :80  ── only /setup and /branch-ca.crt, for first-time phone setup
```

Each phone is set up **once**. It keeps working on the branch Wi-Fi for as long as Caddy's
certificate folder is kept: the root certificate lasts about 10 years, and Caddy renews the site
certificate by itself.

## 1. Give the office computer a fixed address

In the Wi-Fi router, add a **DHCP reservation** for the office computer, for example
`192.168.1.20`. The certificate is issued for this address, and phones bookmark it.

## 2. Build and run the app on localhost only

On the office computer, in the project folder:

```bash
npm ci
npm run build
npm run start:lan          # next start -H 127.0.0.1 -p 3000
```

No address is baked into the build. The app works out the phone addresses (IP and ports) from
each request, so a new IP or port needs a restart of Caddy at most, never a rebuild.

`start:lan` listens on `127.0.0.1` only, so port 3000 is not reachable from the Wi-Fi. Caddy is
the only way in.

Run it at startup, for example with Task Scheduler ("At startup", with "Run whether user is
logged on or not") or a service wrapper such as NSSM.

`npm run dev:https` is a developer convenience and is not part of this deployment.

## 3. Install and start Caddy

1. Download Caddy from <https://caddyserver.com/download> or the GitHub releases, and check the
   published checksum.
2. Set the environment variables for the account Caddy runs as:
   - `BRANCH_IP=192.168.1.20`. This is required, and Caddy refuses to start without it.
   - `HTTP_PORT` / `HTTPS_PORT`: only if 80 or 443 are taken. Caddy passes both to the app, so the
     Settings QR code and the setup page include the new ports by themselves.
   - The app (not Caddy) serves `root.crt` as `/branch-ca.crt`. It finds Caddy's folder by itself
     when both run as the same user. Only if Caddy runs as another account, set `CADDY_CA_DIR`
     **for the app** to the folder holding `root.crt`:
     - Windows service under LocalSystem:
       `C:\Windows\System32\config\systemprofile\AppData\Roaming\Caddy\pki\authorities\local`
     - Linux package service: `/var/lib/caddy/.local/share/caddy/pki/authorities/local`
     - Defaults when run as your user: Windows `%AppData%\Caddy\pki\authorities\local`, Linux
       `~/.local/share/caddy/pki/authorities/local`
3. Check and start it:

   ```bash
   caddy validate --config deploy/Caddyfile --adapter caddyfile
   caddy run --config deploy/Caddyfile --adapter caddyfile
   ```

   On the first start Caddy creates its local certificate authority. Confirm that
   `http://192.168.1.20/branch-ca.crt` now downloads a file (before that it says the certificate
   is not ready). Caddy may also offer to trust it on the office computer itself,
   which needs admin rights and is fine to accept.
4. Run Caddy as a service so it starts with the computer. See "Running Caddy as a service" in
   the Caddy docs (Windows: `sc.exe`; Linux: the packaged systemd unit).
5. **Back up the `pki` folder** (the parent of `CADDY_CA_DIR`) somewhere safe and private. If it
   is lost, Caddy creates a new authority, and every phone has to be set up again. If you move to
   a new office computer, copy this folder across and the phones keep working.

What the Caddyfile does:

- `https://192.168.1.20` serves the console with a certificate from the local CA, issued for the
  IP address itself.
- `http://192.168.1.20` serves only the phone setup page, the files it needs, the address
  lookup (`/api/branch-address`), and `/branch-ca.crt` (the public root certificate). Typing just `192.168.1.20` opens the setup
  page, which sends phones that are already set up straight to Scan Parcel. Every other http
  address redirects to https.
- The CA's private key (`root.key`) is never served. It stays on the office computer.
- It adds `Permissions-Policy: camera=(self)` and deliberately no HSTS, so the setup page stays
  reachable over http.

## 4. Firewall: LAN only

Windows (PowerShell as admin). First make sure the branch Wi-Fi is set to the **Private**
network profile, then:

```powershell
New-NetFirewallRule -DisplayName "Parcel console (Caddy)" -Direction Inbound -Protocol TCP `
  -LocalPort 80,443 -Profile Private -Action Allow
```

- Do **not** add port forwarding on the router.
- Port 3000 needs no rule, because the app listens on 127.0.0.1 only.

## 5. Set up each staff phone (once)

The app guides staff through this itself.

1. On the office computer, open **Settings** at `https://192.168.1.20/settings`. At the bottom,
   **Set up a staff phone** shows **Ready for phones?** (Caddy running, with its ports; the
   certificate ready to download, with its expiry and fingerprint) and a QR code. Both checks
   should be green before setting up phones.
2. On the phone, connected to the branch Wi-Fi, open the normal **Camera** app and point it at
   the code. Tap the link. You can also type `http://192.168.1.20/setup`.
3. The setup page detects iPhone or Android and shows only those steps:
   - **iPhone:** download in Safari › Settings › Profile Downloaded › Install, then Settings ›
     General › About › Certificate Trust Settings › turn on "Caddy Local Authority". The page
     warns if it was opened in Chrome on iPhone, because certificates install from Safari only.
   - **Android:** download in Chrome, then Settings › search "CA certificate" › Install a
     certificate › CA certificate › choose `branch-ca.crt`.
4. Tap **Check my phone**. The page tests whether the phone now trusts the certificate. If not,
   it names the step most often missed. When it says **This phone is ready**, tap
   **Open Scan Parcel** and add it to the Home Screen.

**Optional fingerprint check (admin).** The certificate is downloaded over plain http. On a
trusted branch Wi-Fi that is a small risk, but you can rule it out by comparing fingerprints:

```bash
certutil -dump "%CADDY_CA_DIR%\root.crt"                                    # Windows: "Cert Hash(sha256)"
openssl x509 -in "$CADDY_CA_DIR/root.crt" -noout -fingerprint -sha256        # Linux/macOS
```

On the phone the fingerprint is shown under: iPhone › Settings › General › VPN & Device
Management › the profile › More Details; Android › Trusted credentials › User › the certificate.

**Personal phones.** Installing the branch certificate means the phone trusts anything signed
with the office computer's `root.key`. Keep that file private and backed up only to a safe
place. If staff use their own phones, tell them they can remove the certificate when they leave
(iPhone: delete the profile; Android: Trusted credentials › User › remove).

## 6. Test on the actual phones

This setup was checked in a desktop browser with a simulated camera. It was not checked on
staff phones. Before relying on it, run through this list on every phone model and browser
staff will use:

| Check | Expected |
| --- | --- |
| Scan the Settings QR with the phone's Camera app | Opens `http://192.168.1.20/setup` |
| Follow the steps, then tap "Check my phone" | "This phone is ready" |
| "Open Scan Parcel" | No certificate warning in the address bar |
| Tap "Scan with camera" the first time | The browser asks for camera permission |
| Deny, then tap "Try again" | "Camera access is blocked" with steps |
| Point at a real parcel label | The code fills in and the parcel shows, with related parcels |
| A label from each carrier the branch receives | Each one is read; note any that are not |
| A worn or crumpled label | After about 12 s the hint appears; typing the code works |
| Close the scanner / switch apps / go to another page | The camera indicator turns off |
| Type just `192.168.1.20` on a phone that is set up | Lands on Scan Parcel over https |

## Upkeep and troubleshooting

- **"Not set up yet" on iPhone even after installing:** the Certificate Trust Settings switch is
  off. This is the step most often missed.
- **"Not set up yet" on Android:** the file was installed as a VPN or Wi-Fi certificate instead
  of a CA certificate, or the browser is not Chrome. Firefox for Android ignores
  user-installed certificates by default.
- **The office computer's IP or a port changed:** set the new `BRANCH_IP` / `HTTP_PORT` /
  `HTTPS_PORT` and restart Caddy. No rebuild; the QR code follows. The phones do **not** need setting up again, because
  the same root certificate signs the new address. Staff just use the new address. A DHCP
  reservation prevents this.
- **New office computer, or Windows reinstalled:** restore the backed-up `pki` folder before
  starting Caddy. Otherwise every phone needs setting up again.
- **The camera works on one phone but not another:** check that browser's camera permission for
  the site. On iPhone: Settings › Safari › Camera.

Do not work around the browser rule. That means no `chrome://flags` "treat insecure origin as
secure", no sharing of `root.key`, and no exposing ports 80 or 443 to the internet.

## Where the code lives

- `deploy/Caddyfile`: the HTTPS and setup routing described above.
- `src/app/setup` and `src/components/setup/phone-setup.tsx`: the phone setup page.
- `src/components/settings/phone-setup-card.tsx`: the QR code in Settings.
- `src/lib/branch-address.ts`: works out the secure address and setup address from each request
  (served at `/api/branch-address`), and holds the "does this phone trust the certificate" check.
- `src/lib/branch-ca.ts`: finds Caddy's `root.crt`, and checks Caddy through its local admin API
  (`127.0.0.1:2019`) for the readiness panel (`/api/branch-status`,
  `src/components/settings/branch-readiness.tsx`).
- `src/app/branch-ca.crt/route.ts`: serves Caddy's public `root.crt`, never `root.key`.
- `src/lib/scanner/camera-barcode.ts`: turns a camera into barcode text. It is the only file that
  knows the decoder is ZXing, and it holds the secure-context check. To change decoders, replace
  `startBarcodeScan` there.
- `src/components/parcels/camera-scanner.tsx`: the scanner screen.
- `src/components/parcels/scan-parcel.tsx`: the parcel lookup. It treats text from the camera, a
  USB or Bluetooth scanner, and the keyboard the same way.
