# Campus Branch console

A small web app for one parcel branch. Every morning the courier system exports the parcels that arrived; this app
imports that file, groups the parcels by customer phone number, and helps staff tell each customer once: by SMS from
an Android phone with the branch SIMs, or by call or Telegram from their own phone. It also scans parcel barcodes,
keeps a history of every message and call, and backs itself up.

It runs on one office computer and is reached by staff laptops and phones over [Tailscale](https://tailscale.com)
HTTPS, so nothing is exposed to the internet. Pickup, payments and delivery stay in the courier's own system: this app
only finds who to contact and contacts them.

English and Khmer (ខ្មែរ), switchable on every device.

---

## Contents

1. [Status](#status)
2. [How it fits together](#how-it-fits-together)
3. [What each page does](#what-each-page-does)
4. [Admin and staff](#admin-and-staff)
5. [What you need](#what-you-need)
6. [Install on the office computer (Windows)](#install-on-the-office-computer-windows)
7. [First account, staff accounts, staff phones](#first-account-staff-accounts-staff-phones)
8. [Set up the SMS gateway phone](#set-up-the-sms-gateway-phone)
9. [A normal day](#a-normal-day)
10. [SMS wording](#sms-wording)
11. [Languages](#languages)
12. [Data, backups and privacy](#data-backups-and-privacy)
13. [Beta testing](#beta-testing)
14. [Troubleshooting](#troubleshooting)
15. [Admin command reference](#admin-command-reference)
16. [Development](#development)
17. [Documentation](#documentation)
18. [License](#license)

---

## Status

**Beta, in use at the branch** (merged into `main` on 2026-10-24 so the branch can start using it). Every part is
built and tested on a test Windows computer, an Android emulator and a stand-in dual-SIM gateway. Still to do: the
real-day checks with the real SIMs and phones (see [Beta testing](#beta-testing)). Bugs found in use are fixed on a
branch and merged again.

| Part | State |
|---|---|
| Login, accounts, first-run code, recovery code | Done |
| Database, start-up self-test, backups, data retention, start at boot | Done |
| Imports (upload and watched folder) | Done |
| Parcels, Scan Parcel, contact history | Done |
| SMS gateway connection, sending queue, test SMS | Done; tested on the Android emulator |
| Acceptance checks (Phase 11) | 31 of 36 pass; 5 need the real day (real export, real SIMs, real phones) |
| SMS from the SIM that matches the customer's carrier (Phase 12) | Built; tested with a stand-in dual-SIM phone |
| Khmer (Phase 13): every screen, Khmer dates, Khmer font | Done; server error messages stay in English |

---

## How it fits together

```
                     Tailscale network (private, encrypted)
   ┌──────────────────────────────────────────────────────────────────────┐
   │                                                                      │
   │   Staff phones and laptops ──HTTPS──▶  Office computer               │
   │   (browser, any network)               Campus Branch app + database  │
   │                                        backups, watched folder       │
   │                                              │                       │
   │                                              │ only the office       │
   │                                              ▼ computer may reach it │
   │                                        Gateway phone (Android)       │
   │                                        SMSGate app, 1 or 2 SIMs ─────┼──▶ SMS to customers
   └──────────────────────────────────────────────────────────────────────┘
```

- **Office computer**: runs the app and holds all the data. Windows 10/11 (Linux also works). It starts the app at
  boot with nobody signed in and keeps itself awake on mains power.
- **Tailscale**: every device signs in to the same Tailscale account. Staff open
  `https://<office-computer>.<your-tailnet>.ts.net` with a normal trusted certificate: nothing to install apart from
  the Tailscale app, no IP addresses, no port numbers.
- **Gateway phone**: an Android phone running [SMSGate](https://github.com/capcom6/android-sms-gateway) in Local Server
  mode. The app hands it one SMS at a time; the phone sends it from the SIM for the customer's carrier. Only the office
  computer can reach it (a Tailscale rule).

---

## What each page does

**Dashboard.** Today at a glance: how far today's arrivals have got (messaged, at the gateway, to retry, no phone
number, not messaged yet), what needs someone now, and today's imports. Buttons for Scan Parcel and Import Arrivals,
and a QR icon that shows the console's address as a QR code so a phone can open it with its camera.

**Import Arrivals.** Bring in the courier's "Today" export (`.xlsx`, `.xls` or `.csv`): upload it, or save it into the
watched folder and press Scan Folder Now (or let the app check the folder every few minutes, if turned on). Every file
gets a review before anything is added: rows found, Shopee rows, rows left out and why, repeat scans collapsed, names or
phones that disagree, parcels already in the database. You pick the arrival day, then Confirm. Import history lists
every file.

**Parcels.** Every parcel, grouped by customer phone and arrival day, or one row per parcel. Search by tracking code,
name or phone; filter by date and status. Open a parcel to see its details and history, fix a phone number, or contact
the customer. Parcels without a valid number are listed apart, ready for a number to be added.

**Scan Parcel.** Point the phone's camera at a parcel barcode (or type the code). It shows the parcel, its customer and
whether they were told, with Call, Telegram, SMS and the contact history right there.

**Notifications.** Where messages go out.
- *Today*: what needs attention, the sending queue (live progress, Pause, Resume, Stop), and **Ready**: everyone who has
  new parcels and has not been told, counted by carrier. One press of *Notify customers* queues one SMS per customer
  (several parcels on one number become one combined SMS). SMS go out one at a time with a random gap.
- *Contact by hand*: customers whose carrier has no SIM in the gateway phone, or whose SMS failed. Call, Telegram or
  SMS from your own phone, then record what happened.
- *History*: every SMS, call and Telegram message, searchable.

A chime plays when a run finishes and beeps when it needs someone (each about 3 seconds; set per device in Settings).

**Settings.** For everyone: whether phones can reach the console ("Ready for phones?"), the staff-phone QR code, the
SMS gateway status and its SIMs, sounds on this device, backups. For the admin also: SMS wording, gap between SMS,
import preferences, the watched folder, how long data is kept, and the test SMS.

---

## Admin and staff

The **first account** created is the **admin**. Every later account is **staff**.

| | Staff | Admin |
|---|---|---|
| Import, review and confirm files | ✓ | ✓ |
| Parcels, Scan, fix phone numbers | ✓ | ✓ |
| Notify customers, Pause/Resume/Stop, contact by hand | ✓ | ✓ |
| Confirm the gateway phone's SIMs | ✓ | ✓ |
| Save a backup now | ✓ | ✓ |
| See the gateway phone's address, send a test SMS | | ✓ |
| Change SMS wording, gap between SMS, import preferences, watched folder, how long data is kept | | ✓ |

Accounts are added and disabled at the office computer (see [Admin command reference](#admin-command-reference)), not
in the app. Signed-in devices stay signed in for up to 30 days, or until 7 days without use.

---

## What you need

| Item | Notes |
|---|---|
| Office computer | Windows 10 (1803 or later) or 11, Home or Pro, x64 or ARM64. 4 GB RAM or more. Stays on and plugged in at the branch |
| Tailscale account | Free plan is enough. In the admin console: MagicDNS **on** and HTTPS certificates **on** |
| Gateway phone | Android, with one or two SIMs (one per carrier you send from), charger always connected. Used only for this |
| Staff phones and laptops | Any recent browser (iPhone Safari, Android Chrome, desktop Chrome/Edge/Firefox) and the Tailscale app |
| The courier export | The "Today" scan record from the courier system, as `.xlsx`, `.xls` or `.csv` |

---

## Install on the office computer (Windows)

1. Download [`deploy/windows/install.ps1`](deploy/windows/install.ps1) to the office computer.
2. Open PowerShell in the download folder and run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File install.ps1
   ```

   It installs `main`. To try a fix before it is merged, add `-Branch <branch name>`.

3. Approve the administrator prompt. The installer then:
   - installs Tailscale if missing (checked against its published SHA-256) and asks you to sign this computer in once,
   - downloads the app and its own Node.js 24.21.0 into `C:\Program Files\CampusBranch` (no system Node.js or Git needed),
   - builds it, creates a local account `campusbranch` that only runs the app, and a private data folder
     `C:\ProgramData\CampusBranch`,
   - creates the shared folder **Campus Branch Imports** (Public Documents, with a desktop shortcut) for the courier export,
   - registers the task **Campus Branch** (starts at boot, restarts on failure), keeps the computer awake on mains power,
   - starts the app, shares it on your tailnet with Tailscale Serve, and prints the **staff address** and, on a new
     install, a **one-time code** for the first account.

If Tailscale prints a link to enable HTTPS for your tailnet, open it and enable it; the installer carries on.

**Update**: run the same command again. The new version is built beside the running one, then swapped in: the app is
down for seconds, and accounts and data stay.

Linux: build the app, then `sudo sh deploy/linux/install.sh` (systemd service, data in `/var/lib/campus-branch`).
Details in `docs/phase3-backups.md`.

---

## First account, staff accounts, staff phones

**First account (once).** Open the staff address on the office computer (or any device signed in to the same
Tailscale account), go to `/login`, type the one-time code the installer printed, and choose the admin's user name and
password (12 characters or more). The code then stops working. In Settings, *Ready for phones?* should say *Yes*.

**Staff accounts.** At the office computer, in PowerShell as administrator:

```powershell
cd 'C:\Program Files\CampusBranch\app'
$env:DATA_DIR = 'C:\ProgramData\CampusBranch'
& 'C:\Program Files\CampusBranch\node\node.exe' --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\user.ts add sokha
```

It prints a generated password once; give it to that person. `... scripts\user.ts disable sokha` disables an account
and signs it out everywhere.

**Staff phones.**
1. Install the Tailscale app and sign in with the branch's Tailscale account (an admin may need to approve the phone).
2. Turn Tailscale on. It works on any network, not only the branch Wi-Fi.
3. Scan the QR code in Settings › *Set up a staff phone* (or on the Dashboard's QR icon), and sign in.
4. Optional: *Add to Home Screen* so it opens like an app.

**Forgotten password.** On the sign-in page choose *Forgot password?* and use the recovery code, which the admin reads
at the office computer with `scripts\recovery-code.ts show` (create one first with `rotate`). Resetting a password
signs that account out everywhere.

---

## Set up the SMS gateway phone

1. **Phone.** Put in the SIM(s): one per carrier you want to send from (for example Cellcard and Smart). Turn off
   battery optimisation for SMSGate, keep the charger connected, and block incoming calls on the SIMs if you can (a
   call during sending can make an SMS fail).
2. **SMSGate.** Install [SMS Gateway for Android](https://github.com/capcom6/android-sms-gateway), give it the SMS
   and Phone permissions, turn on **Local Server** (port 8080). Note its username and password.
3. **Tailscale on the phone.** Sign in to the same tailnet, turn on Always-on VPN. In the Tailscale admin console give
   the phone the tag `tag:gateway` and the office computer `tag:office`, and apply the rules in
   [`docs/tailnet-rules.md`](docs/tailnet-rules.md): only the office computer may reach the phone on port 8080.
4. **Connect it** at the office computer (PowerShell as administrator):

   ```powershell
   cd 'C:\Program Files\CampusBranch\app'
   $env:DATA_DIR = 'C:\ProgramData\CampusBranch'
   & 'C:\Program Files\CampusBranch\node\node.exe' --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\gateway.ts set
   ```

   It asks for the phone's address (`http://<phone name>:8080`), username and password, checks them with the phone and
   saves them in `gateway.json` in the data folder (never in the database, never shown to staff). Type the password;
   do not paste it into chats or files.
5. **Confirm the SIMs.** Settings › SMS gateway › **Scan SIMs**, then confirm each SIM's carrier. Customers
   whose carrier has a confirmed SIM get SMS from that SIM; everyone else goes to *Contact by hand*. There is no
   fallback SIM: a Smart customer is never sent an SMS from the Cellcard SIM.
6. **Test SMS** (admin): Settings › SMS gateway › Test SMS, to your **own** number, once per SIM. Each should reach
   *Delivered*.

If the phone is away (off, no network, SMSGate stopped), SMS wait in the queue and go out once it is back. None is sent
twice. If one SIM fails twice in a row (no credit, blocked), the run pauses until someone presses Resume.

---

## A normal day

1. **Morning import.** Export *Today* from the courier system and save it into **Campus Branch Imports** (or upload it
   on Import Arrivals). Press *Scan Folder Now*, open the file's review, check the numbers and the arrival day, then
   **Confirm**.
2. **Fix missing numbers.** Parcels → *Missing phone numbers*: add the number from the parcel label, or leave it
   for contact at pickup.
3. **Notify.** Notifications → Today → Ready shows how many customers get an SMS, per carrier, and how many need contact
   by hand. Press **Notify customers**. Keep the tab open if you want the sounds; sending continues on the office
   computer either way.
4. **Contact by hand.** Notifications → *Contact by hand*: call, Telegram or SMS from your own phone, then answer the
   question the app asks (Reached or No answer; whether you sent the message).
5. **At the counter.** Scan Parcel with a phone camera to find a parcel and its customer.
6. **Anything red** on the Dashboard or Notifications (failed SMS, gateway away, paused run) says what to do.

---

## SMS wording

Settings › *Default SMS message* (admin) has two texts: one for a single parcel, one for several parcels on one number.

| Placeholder | Becomes |
|---|---|
| `{name}` | the customer's first name |
| `{codes}` | the tracking code(s), comma separated (required) |
| `{count}` | the number of parcels |
| `{date}` | the arrival day, as dd-mm-yyyy |
| `{newline}` | a line break (pressing Enter does the same) |

The preview below each box shows the real message. Length: an SMS in English holds 160 characters per part; **an SMS
with any Khmer letter holds about 70 per part**, so a long Khmer message costs several SMS. Each line break counts as
one character.

The gap between two SMS is random within a range (default 25–80 seconds, at least 15), set in Settings › *Gap between
SMS* (admin). A steady, slow pace keeps carriers from flagging the SIM.

---

## Languages

The switch in the top bar (UK flag EN, Cambodian flag KM) changes the language on that device only; each phone and
computer remembers its own choice. Arrow keys work on it too.

- Every screen, button and message on screen is translated, including dates ("សៅរ៍ 24 តុលា", 24-hour clock).
- Messages that come from the server (some error texts, Tailscale checks, SMS failure reasons) stay in English.
- English and Khmer use the same font (Kantumruy Pro), sized so the page looks the same in both languages.
- The wording lives in `src/locales/en.json` and `src/locales/km.json`; rules for translators are in
  `docs/phase13-khmer.md`.

---

## Data, backups and privacy

- **Where data lives**: only on the office computer, in `C:\ProgramData\CampusBranch` (Linux:
  `/var/lib/campus-branch`). Only the app's account, administrators and the system can open it. It holds customer
  names and phone numbers: keep it private and never copy it to shared drives or chats.
- **How long**: parcels are deleted N days after their arrival day, with their messages, calls and imports (default 7,
  from 1 to 14; Settings › Backups and data, admin). Settings says how much the next deletion removes. Accounts and
  settings stay.
- **Backups**: automatic, on the office computer: one 5 minutes after changes (at most every 15 minutes) and one at
  every stop. Kept 7 days. Settings shows the last backup, a *Save backup now* button, and a red warning if backups
  fail twice in a row.
- **Restore** (admin, office computer): stop the app, list the backups, put one back, start the app (commands below).
  The current database is saved first. After a restore the app **holds all SMS** until a staff member checks the
  queue on Notifications, so nobody is messaged twice.
- **Passwords** are stored hashed; sign-in sessions as hashes. A copy of the database cannot be used to sign in.
- **The gateway password** lives only in `gateway.json` in the data folder.
- **Nothing is public.** The app listens only on the office computer itself; Tailscale Serve shares it on your tailnet.

---

## Beta testing

The beta can run at the branch now, in two steps, so nothing reaches customers before the SIMs are proven.

**Step 1: work without automatic SMS (safe from day one).**
Install, create the accounts, connect staff phones, but **do not connect the gateway phone yet**.
Staff use imports, Parcels, Scan Parcel and *Contact by hand* (calls and Telegram from their own phones) for real.
If someone presses *Notify customers* in this step, the SMS only wait ("Waiting for the gateway phone"); press **Stop**
on that run in Notifications before connecting the gateway, or they will go out when it connects.

**Step 2: turn on SMS (after the real-day checks).**
Connect the gateway phone, confirm the SIMs, send a test SMS from each SIM to your own number, then notify a small
batch (a few customers) and watch it finish before using it for the whole day.

**What to note during the beta** (one line each is enough, in a shared chat or sheet):

| When | Page | What you did | What happened | What you expected | Screenshot? |
|---|---|---|---|---|---|

Especially useful: anything confusing, slow, or wrong in Khmer; numbers that do not match the courier file; a
customer who got no SMS or two; a phone that cannot open the app.

**Real-day checklist** (needed before going live, see `docs/phase11-acceptance.md`):
- [ ] Import a real courier export on the branch computer; counts match the file
- [ ] A staff phone opens the app over Tailscale; a device outside the rules is refused
- [ ] Test SMS from each SIM to your own number, on Wi-Fi and on mobile data: Delivered, from the right SIM
- [ ] Gateway phone: restart, airplane mode, low battery: SMS wait, then go out once
- [ ] Camera scan on iPhone Safari and Android Chrome
- [ ] A small real batch reaches real customers
- [ ] Owner approves going live; router admin password changed

---

## Troubleshooting

| Problem | What to check |
|---|---|
| Phone cannot open the app | Tailscale on and signed in to the branch account? Settings › *Ready for phones?* on the office computer says what is missing |
| "Waiting for the gateway phone" | Gateway phone on, charged, Tailscale on, SMSGate running. SMS go out by themselves once it answers |
| A carrier's customers all go to *Contact by hand* | No confirmed SIM for that carrier: Settings › SMS gateway › Scan SIMs, then confirm them |
| Run paused after failures | Check that SIM's credit and signal, then Resume in Notifications |
| SMS show "Failed" | The History tab shows the reason; contact those customers by hand or send again from the parcel |
| File refused on import | The review says why (missing columns, not a scan record, already imported) |
| Watched folder finds nothing | Saved into **Campus Branch Imports**? Press Scan Folder Now; check the folder path in Settings |
| "Backups are failing" | Disk full or the data folder moved; tell the admin, check the log |
| App does not answer at all | On the office computer: the task **Campus Branch** in Task Scheduler, and the log `C:\ProgramData\CampusBranch\logs\serve.log` |
| Forgot the admin password | Recovery code (Forgot password on the sign-in page) |

---

## Admin command reference

Windows, in PowerShell **as administrator**. Set these once per window:

```powershell
cd 'C:\Program Files\CampusBranch\app'
$env:DATA_DIR = 'C:\ProgramData\CampusBranch'
$node = 'C:\Program Files\CampusBranch\node\node.exe'
```

| Task | Command |
|---|---|
| Update the app | run `install.ps1` again |
| Stop the app | `Disable-ScheduledTask 'Campus Branch'; Stop-ScheduledTask 'Campus Branch'` |
| Start the app | `Enable-ScheduledTask 'Campus Branch'; Start-ScheduledTask 'Campus Branch'` |
| Add a staff account | `& $node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\user.ts add <username>` |
| Disable an account | `& $node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\user.ts disable <username>` |
| Connect the gateway phone | `& $node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\gateway.ts set` |
| Show the gateway address | `& $node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\gateway.ts show` |
| Recovery code | `... scripts\recovery-code.ts show` · `rotate` (new code) · `revoke` |
| List backups | stop the app, then `& $node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\restore.ts` |
| Restore backup number 2 | `... scripts\restore.ts 2`, then start the app |
| Log file | `C:\ProgramData\CampusBranch\logs\serve.log` |
| Uninstall | `Unregister-ScheduledTask 'Campus Branch' -Confirm:$false; Remove-LocalUser campusbranch`, then delete `C:\Program Files\CampusBranch` (and `C:\ProgramData\CampusBranch`, which holds the customer data) |

On Linux or in development the same tools are npm scripts: `npm run user -- add <name>`, `npm run gateway -- set`,
`npm run recovery-code -- show`, `npm run restore`, `npm run first-run-code`, with `DATA_DIR` pointing at the data
folder (default `~/.local/share/campus-branch`).

---

## Development

**Stack**: Next.js 16 (App Router) and React 19, TypeScript, Tailwind CSS 4, SQLite through better-sqlite3 and Drizzle,
Node.js 24.21.0 (`.node-version`). Barcode scanning with ZXing, spreadsheets with SheetJS (vendored). Own small i18n,
no library. All dependencies pinned to exact versions.

```sh
npm ci
npm run dev                 # migrates the database, then http://127.0.0.1:3000
npm run first-run-code      # the one-time code for the first account
npm run db:seed             # optional: fictional sample parcels (refuses production data folders)
npm run sms-worker          # the SMS worker beside `npm run dev`
npm run gateway -- set      # connect an SMSGate phone or emulator
```

The development database lives in `~/.local/share/campus-branch` (or `DATA_DIR`), never in the project.

| Command | What it does |
|---|---|
| `npm test` | unit tests (`src/**/*.test.ts`, Node's own test runner) |
| `npm run test:integration` | builds a temporary copy and tests the real server (never touches the project's `.next`) |
| `npx tsc --noEmit -p .` | type check |
| `npm run build` | production build; **run it in a separate clone**, not the folder a dev server is running from (they share `.next`) |
| `npm run serve` | the production launcher: migrate, self-test, retention, backup, then the app and the SMS worker |
| `npm run locales` | keeps `km.json` in step with `en.json` (adds new keys in English, removes old ones, keeps translations) |

**Layout**

```
src/app/            pages (console, login, setup) and API routes (src/app/api/...)
src/components/     UI by page: dashboard, import, parcels, notifications, settings, shell, shared, ui
src/lib/            browser-safe logic: parcels, carriers, dates, i18n, settings checks (unit tested)
src/server/         server only: auth, db (schema, migrations, backup, retention), imports, folder, gateway, sms queue
src/locales/        en.json (source) and km.json
scripts/            launcher and admin tools (serve, user, gateway, restore, recovery-code, first-run-code)
deploy/             Windows installer, Linux systemd service
drizzle/            database migrations
docs/               design and test records for every phase
test/               integration tests and synthetic import fixtures
```

**Rules for contributors**
- Never commit real customer data. Courier exports (`*.xls`, `*.xlsx`) are git-ignored; tests use the synthetic files
  in `test/fixtures/`. A local pre-commit hook blocks secrets and customer data.
- Never commit a real tailnet name, IP address or password.
- New on-screen text goes into `src/locales/en.json` (and `km.json`), never straight into a component.

---

## Documentation

| Topic | File |
|---|---|
| Tailscale HTTPS setup | `docs/deploy-tailscale.md` |
| Tailscale rules (who may reach what) | `docs/tailnet-rules.md` |
| Courier export format and import rules | `docs/import-rules.md` |
| Database schema | `docs/phase1-schema.md` |
| Login, accounts, recovery | `docs/phase2-login.md` |
| Backups, retention, start at boot, restore | `docs/phase3-backups.md` |
| Imports and the watched folder | `docs/phase4-imports.md`, `docs/phase5-folder.md` |
| Parcels and contact history | `docs/phase6-parcels.md` |
| SMS gateway (SMSGate) | `docs/phase8-gateway.md`, `docs/smsgate-verification.md` |
| Sending queue | `docs/phase9-queue.md` |
| Hardening, shared settings | `docs/phase10-hardening.md` |
| Acceptance tests and the real-day list | `docs/phase11-acceptance.md` |
| Dual SIM, SMS by carrier | `docs/phase12-dual-sim.md` |
| Khmer, translation rules | `docs/phase13-khmer.md` |

---

## License

MIT, see `LICENSE`.
