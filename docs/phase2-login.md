# Phase 2: login and sessions

Status: **merged into `main` on 2026-10-16 with the owner's explicit approval.** Device acceptance was
**confirmed by the owner on 2026-10-16** (after the merge): laptop, phone and password recovery PASS; Settings 7/7 PASS after the Live HTTPS
check fix (`343ba44`). The Next.js security advisory review was done on
2026-10-15: Next.js moved to the patched **16.4.1** on this branch (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr,
GHSA-p3m5-59mp-jv5r; see `docs/phase0.md`, "Merge and follow-ups"). Synthetic data only; no deployment.

Source: backend plan Revision 3, "Security, privacy and operations" (Login), "Changes to the existing code" (new
modules) and "Phased plan" (Phase 2).

## What was built

| Plan requirement | Where |
|---|---|
| Username and password accounts, scrypt, no auth library | `src/server/auth/password.ts` (N=2^15, r=8, p=1, 16-byte salt, 64-byte key, constant-time compare) |
| No default account; first account via a one-time code written to the data folder | `src/server/auth/accounts.ts` (`ensureFirstRunCode`, `createFirstAccount`), `/login` first-run form, `POST /api/auth/setup` |
| Session cookie HttpOnly, Secure, SameSite=Lax; idle expiry | `src/server/auth/cookie.ts` (`__Host-cb_session`), `src/server/auth/sessions.ts` |
| Five wrong passwords in a row pause logins for a minute | `src/server/auth/pause.ts` (per username typed, known or not) |
| `proxy.ts` redirects only | `src/proxy.ts` (no database; skips API routes, `/login`, `/setup`, `/branch-ca.crt`, files) |
| Every API route and server page checks the session itself | `withSession()` in `src/server/auth/guard.ts`; `requirePageUser()` in `src/server/auth/page.ts`, called by the console layout |
| Changes must carry an Origin matching the branch address | `refuseCrossSite()` / `src/server/auth/origin.ts` on every non-GET route |
| Phone Setup page stays open | `/setup` and `/branch-ca.crt` are not redirected |
| Login audit | `login.succeeded`, `login.failed`, `login.paused`, `session.ended`, `user.created`, `user.disabled`, `user.first_run_refused` |

Further accounts: `npm run user -- add <username>` (prints a generated password once) and `npm run user -- disable
<username>` (also ends its sessions), run at the office computer.

Before any database-backed route, `openVerifiedDatabase()` was verified inside the real Next.js server bundle
(`npm run test:integration`): Turbopack keeps `import.meta.url` at the source file, so the project root and `drizzle/`
resolve correctly. Two build warnings found there (the data-folder lookup made Turbopack trace the whole project) were
fixed with `turbopackIgnore`.

## First-run code

The code stays in `first-run-code.txt` in the data folder (mode 0600, written once, never overwritten). To read it, run
this on the office computer, in the project folder:

```
npm run first-run-code
```

It prints the code only to a terminal: it refuses when its output is a pipe or a file, so the code cannot end up in a
log by accident. It only reads: if the file does not exist (the sign-in page has not been opened yet, or the file was
deleted), it says so and exits without creating a code; only the sign-in page creates one. Once an account exists, the
command refuses, removes any leftover file, and the code no longer works (`/api/auth/setup` answers 409). The code is never shown on a web page, sent by an API, written to the server log (the log names only the file and
the command) or stored in the audit log.

## Login page

- Desktop (lg, 1024 px and up): a split screen. The navy panel shows the brand, one line about the product and the
  parcel-journey diagram with three step cards. The sign-in card sits on the warm neutral background. Phones: a compact
  navy band with the brand and the diagram, then the card, in a single column.
- The parcel journey (`src/components/auth/parcel-journey.tsx`, Anime.js 4.5.0) shows the real workflow as one
  timeline: the parcel is scanned in, travels the route to sorting, then the phone's badge and "SMS ready" light up. It
  loops with a pause. The server renders the finished diagram, which is also what visitors with
  `prefers-reduced-motion` or without JavaScript see. The timeline pauses while the page is hidden, and switching on
  reduced motion stops it and restores the static diagram. On unmount the timeline is reverted and listeners are
  removed. The art is local SVG only.
- Form feedback: a spinner and "Signing in…" while the request runs; on an error, the message appears in a fixed-height
  slot, the field concerned gets `aria-invalid` and focus, and the form gives a short shake (skipped with reduced
  motion); on success the button shows "Signed in" while the redirect starts at once. No feedback delays the request
  or the redirect.

## Supported login addresses

Sign-in (a POST) is accepted only from the branch address or the office computer itself (`src/server/auth/origin.ts`);
the session cookie also needs HTTPS or loopback.

| Address | Who | Sign-in works |
|---|---|---|
| `https://spacek4k.tailc4ca3f.ts.net` (Tailscale Serve → `127.0.0.1:3000`) | staff laptop and phones on the tailnet | **Yes** |
| `http://127.0.0.1:3000`, `http://localhost:3000` | the office computer itself | **Yes** |
| The origin in `BRANCH_URL`, if set (it replaces the Tailscale name) | as configured | **Yes** |
| Old Caddy LAN addresses, e.g. `https://192.168.1.10`, `https://172.20.10.3` | — | **No.** The sign-in page loads, but the sign-in request is refused (403, cross-site) by the origin rule (unit and integration tested; not sent through Caddy, which is not running) |
| `http://<LAN-IP>:3000` | — | No: the app listens on 127.0.0.1 only |

The phone Setup page (`/setup`) and `/branch-ca.crt` stay open on every address.

Against the agreed deployment: the hosting plan moves from Caddy on the LAN IP to Tailscale Serve (phases approved
2026-10-12), keeping Caddy only as a rollback until the real-phone test passes. So no conflict with the target set-up,
with one dependency to flag. If that phone test fails and the branch rolls back to Caddy, staff could not sign in over
the LAN address unless `BRANCH_URL` is set to it. That is a single address, and the laptop's LAN IP changes, which is
why the migration was started.

## Recovery code (password reset)

Added 2026-10-14 on `phase2-login` to the owner's specification. **Design approved by the owner 2026-10-15**, with five
decisions: (1) one installation-wide code that can reset any active account; (2) a new `recovery_codes` table through
migration `0002`, never by editing `0000`; (3) disabled accounts cannot recover themselves; (4) a successful reset
consumes the code, revokes all sessions and requires a normal sign-in; (5) five failed attempts pause recovery for one
minute, with the in-memory limitation documented below. One recovery code for the installation lets a person
who has lost their password set a new one on the sign-in page ("Forgot password?"). It is separate from the first-run
code: its own file, its own table, its own pause counter, and neither code is accepted in place of the other.

| Rule | How |
|---|---|
| Format | 32 Crockford Base32 characters (`0-9`, `A-Z` without `I L O U`), shown as eight groups of four: `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`. Typing is case-, space- and dash-insensitive; `O` reads as `0`, `I`/`L` as `1` |
| Entropy | 20 bytes from `crypto.randomBytes` = 160 bits = exactly 32 characters (5 bits each) |
| Where the code is kept | `recovery-code.txt` in the data folder (`DATA_DIR`, default `~/.local/share/campus-branch`; 0700, outside the repository), mode 0600, written to a temporary 0600 file, fsynced, then renamed into place |
| Where validity is decided | Table `recovery_codes` (migration `0002`): only the SHA-256 of the code, `created_at`, `ended_at`, `end_reason` (`used` / `rotated` / `revoked`), `used_by`. A unique partial index allows at most one active row (`ended_at IS NULL`). The file is never trusted on its own: a code is valid only if its hash matches the active row |
| Expiry | None by time. Valid until used once, rotated or revoked |
| One use | On success, one `BEGIN IMMEDIATE` transaction: mark the code `used` (only if still active), replace the password hash, delete every session of the account, audit `user.password_recovered`. Then the file is removed; if that fails, the code is still invalid because the database says it is used, and the leftover file is removed at the next `show` |
| Failed attempts | Wrong code, unknown or disabled account, or an already used code: same answer (403 `bad_recovery`), the code stays as it was, audit `user.recovery_refused` with `error_code` only. Five failures pause recovery for a minute (one counter for the installation). A password under 12 characters is refused (400) before the code is checked |
| Pause limitation | The failure counter lives in the web process's memory, like the login pause (open issue 4): restarting the app clears it, and a second web process would count separately. Acceptable while one process runs on the office computer, since a restart needs that computer; the 160-bit code makes guessing infeasible regardless. Move the counter to the database if a second process or remote restarts are added |
| Disabled accounts | Cannot be recovered; enabling stays a separate step |
| Concurrency | The "still active" check is repeated inside the write lock, so two requests with the same code: exactly one succeeds |
| Exposure | The code is printed only by `show`, only to a terminal. Not in any API response, server log line, audit entry (not even its hash) or Git (the data folder is outside the repository, which the app enforces; `.gitignore` also lists `recovery-code.txt*` and `first-run-code.txt` in case a copy is made) |

Commands (office computer, in the project folder):

```
npm run recovery-code -- rotate   # create the first code, or replace the active one (the old one stops working at once)
npm run recovery-code -- show     # print the active code; refuses a pipe or file
npm run recovery-code -- revoke   # end the active code without a replacement
```

The "Forgot password?" link switches the card to **Reset your password** (its own heading and one-line explanation; focus
moves to the heading so screen readers announce it). The form lists both commands in this order (`rotate`, then
`show`), each with a Copy button. "Back to sign in" returns to **Sign in**, as does a successful reset, which shows
"Password changed. Every device was signed out."

No code exists until the first `rotate`; nothing creates one by itself. `show` never creates or repairs: with no active
code it says so; if the file is missing or does not match the active code, it refuses and tells you to `rotate`.

Rotate order and failure handling: remove temporary files left by an earlier stopped run → write the new code to a
temporary 0600 file and fsync → database transaction (end the old code, insert the new hash, audit
`recovery_code.rotated`) → rename into place.

| Failure | Result | What to do |
|---|---|---|
| Before or during the database transaction (e.g. disk full) | Nothing changes: the temporary file is removed, the old code and its file stay valid | Nothing; `rotate` again when the cause is fixed |
| The rename fails after the commit | **Fails closed.** The old code is already ended, the new code's temporary file is removed, so no code is valid that anyone holds. `rotate` exits 1 with "the new code is active but could not be saved … run rotate again" | `npm run recovery-code -- rotate` |
| The process stops after the commit, before the rename (power cut, kill) | **Fails closed.** The old code is ended; the new one exists only in a leftover temporary file (0600, in the 0700 data folder), which `show` never reads. `show` refuses with "does not match the active code" | `npm run recovery-code -- rotate`: it removes the leftover temporary file and makes a fresh code. `revoke` removes it too |

Restoring a usable code never prints, logs or copies the stranded code: `rotate` replaces it, and `show` then prints the
new one to the terminal only. In both fail-closed cases recovery with the old code is refused and every password stays
as it was.

After a recovery, the person signs in with the new password on every device. Rotate a new code afterwards if one should
stay available (`show` reports "no active recovery code" until then).

## Routes

| Route | Signed out | Notes |
|---|---|---|
| `POST /api/auth/login` | public | 401 wrong credentials, 429 + `Retry-After` while paused, 403 cross-site, 400 bad body |
| `POST /api/auth/setup` | public while no account exists | 403 wrong code, 409 once an account exists |
| `POST /api/auth/recover` | public | recovery code + username + new password; 200 (session cookie cleared), 403 `bad_recovery`, 400 short password, 429 + `Retry-After` while paused, 403 cross-site |
| `POST /api/auth/logout` | 401 (cookie cleared anyway) | ends the session row on the server |
| `GET /api/auth/session` | 401 | `{ username }` |
| `GET /api/branch-status` | 401 | Settings readiness checks |
| `GET /api/branch-address` | public, on purpose | used by the open phone Setup page and by Settings' live HTTPS self-check; returns only the branch's own addresses |
| Console pages | redirect to `/login?next=…` | the layout checks the session even if the proxy is bypassed |

The integration test finds every `route.ts` under `src/app/api` and requires 401 for each exported method except the
three public routes, so a new route without `withSession()` fails the suite.

## Session policy (owner decision 2026-10-14, plan decision 9)

Campus Branch is an internal application reachable only over the private network (the tailnet, or the office computer
itself), so sessions are long for staff convenience. Expiry is still enforced by the server on every request.

| Rule | Value | Where |
|---|---|---|
| Idle timeout: signed out after this long without use | **7 days** | `SESSION_IDLE_MS`, `src/server/auth/sessions.ts` |
| Absolute lifetime: signed out this long after sign-in, however often used | **30 days**; set once at sign-in (`sessions.expires_at`) and never extended by activity | `SESSION_MAX_MS` |
| Cookie lifetime | Persistent, `Max-Age` = 30 days (2,592,000 s) from sign-in, matching the absolute lifetime; the server refuses the session earlier if it is idle, logged out, revoked or past its deadline | `src/server/auth/cookie.ts` |
| Revocation | Logout deletes the session row; disabling an account deletes all its sessions | `logOut`, `disableUser` |
| How many accounts | First account from the first-run screen; any further ones with `npm run user -- add` | — |
| Password rules | 12–256 characters; usernames 3–32 of `a-z 0-9 . _ -`, case-insensitive | `src/server/auth/password.ts` |

Replaced the earlier provisional values (12 hours idle, 7 days absolute).

## Security notes

- The cookie holds a 32-byte random token. The database stores only its SHA-256, so a copy of the database or a backup
  cannot be used to sign in. `__Host-` makes browsers refuse the cookie unless it is Secure, Path=/ and has no Domain.
  Checked in Chromium: the cookie is stored over `http://127.0.0.1` (a secure context) and is not visible to page scripts.
- Unknown usernames cost the same scrypt work as known ones (a real dummy hash) and get the same answer and pause.
- The audit log never holds the typed username (it may be a mistyped password), the password, the token or the
  first-run code; failed logins record the user's ID only when the account exists.
- A session ends when idle for 7 days, 30 days after sign-in, on logout, or when its account is disabled; expired rows are
  deleted when seen and whenever a new session is created.
- Origin rule: allowed are exactly the branch address (`BRANCH_URL`, else the Tailscale Serve name) and a loopback
  origin equal to the host the request was sent to.

## Tests

- `npm test`: 12 auth unit tests (including the pinned session policy and a 30-day run of daily use that never moves
  the deadline) and the `safeNextPath` test added. Rule mutations checked: removing idle expiry, removing the pause,
  or letting activity extend `expires_at` each makes the auth tests fail.
- `npm test`: the `npm run user` command test is in `src/server/db/startup.test.ts`.
- `npm run test:integration` (builds a temporary copy; about 30 s): 11 tests, covering the server bundle (2) and login
  through `next start` (9). Removing `withSession()` from `/api/branch-status` makes the route test fail.
- Browser check (Chromium, 390 px wide, not part of the suite): first run, the cookie, reload, sign-out and sign-in all
  work; 28 of 28 console pages load signed in without console errors.

- `npm test`: the `first-run-code` test runs the command under `script` to give it a real terminal. It covers: refused
  before `db:migrate`; refused into a pipe; the code shown; the same code on a second run; the file stays 0600; refused
  after setup; the file removed; the old code rejected; the code absent from the audit log.
- Login page browser check (Chromium, not part of the suite):
  - 1366, 1024, 390 and 360 px: no sideways scrolling, layout shift 0, no console errors.
  - The timeline loops through scan, sort and notify. It pauses while the page is hidden and resumes afterwards.
  - Reduced motion shows the finished diagram with nothing moving. Switching to it mid-run restores the static diagram
    with no leftover attributes.
  - Tab order: code, username, password, repeat password, button. Focus is visible.
  - A wrong code focuses the code field, sets `aria-invalid` and does not move the button. The first-run and sign-in
    flows reach the dashboard.

- Recovery code (`src/server/auth/recovery.test.ts`, 18 tests): format and Crockford decoding of all 160 bits, the
  20-byte random request, 0600 file with no temporary file left and only a hash stored, no time expiry (5 years later),
  one-time use (password changed, all sessions ended, code consumed, file removed, second use refused), invalid
  attempts (wrong code, unknown or disabled account, short password: code untouched), the one-minute pause, rotation,
  revoke, and failure handling (file not removable after success, database error during rotate, missing or planted
  file, two simultaneous uses) and failure injection after the commit: the rename throwing (mocked), and a real stop
  (a child process kills itself with SIGKILL at the rename). Both fail closed (old code refused, `show` refuses, password
  unchanged) and a following `rotate` removes leftover temporary files and restores a usable code. Mutations checked: dropping the in-transaction re-check, the session revocation, the
  file-versus-database check, the pause, the 0600 mode, the leftover temporary-file cleanup, or removing the temporary
  file when the rename fails each makes a test fail.
- `npm test`: the `recovery-code` command test (`startup.test.ts`) runs `show` under `script`: never creates a code,
  refuses a pipe, `rotate` does not print the code, a missing file is reported and not regenerated, `revoke` twice.
- `npm run test:integration`: 12 tests; the new one drives `POST /api/auth/recover` through `next start`: cross-site,
  wrong code and short password refused, success clears the cookie and ends the existing session, second use refused,
  the code absent from the audit log and the server output.
- Migration tests now expect 19 tables (18 approved + `recovery_codes`) and 30 indexes. Stale test databases are built
  with `applyPending` directly, because `migrateDatabase`'s self-test refuses a database without the later table.

## Device acceptance (owner-confirmed, 2026-10-16)

Run by the owner on their own devices against the running server at `https://spacek4k.tailc4ca3f.ts.net` (Next.js
16.4.1). Reported by the owner as working as expected; not observed by Claude.

| Check | Result |
|---|---|
| Laptop: sign-in, session, logout | **PASS** (owner-confirmed) |
| Phone: Tailscale, Safari, barcode scan with the camera | **PASS** (owner-confirmed) |
| Password recovery | **PASS** (owner-confirmed) |
| Settings › Ready for phones? 7/7 | **PASS** (owner-confirmed, `npm run dev`, after fix `343ba44`) |

## Open issues

1. **Security advisory review (Phase 0): done 2026-10-15.** Next.js 16.4.1 (exact pin) fixes the three 2026-10-14
   advisories that affected 16.4.0; TypeScript 6.0.3 final. `main` stays on the affected 16.4.0 until this branch is
   merged. After pulling, run `npm ci` in the project folder (with the dev server stopped).
2. **Phase 2 device checks: owner-confirmed PASS 2026-10-16** for the laptop, phone, recovery and Settings 7/7 (see
   "Device acceptance"). The office laptop needed an `/etc/hosts` line to open the address in its browsers because
   Cloudflare WARP owns its DNS (`docs/deploy-tailscale.md`, Troubleshooting); this is a device setting, not an app
   change.
3. Login works through the branch address (Tailscale or `BRANCH_URL`) and on the office computer at `127.0.0.1` or
   `localhost`. The legacy Caddy LAN addresses are not accepted origins (and a plain-http LAN address cannot hold a
   Secure cookie). Set `BRANCH_URL` if Caddy must stay in use.
4. The login pause counter (five failures, then a one-minute pause) lives in the web process's memory. A restart clears
   it, and a second web process would keep its own count. Acceptable for one web process on the office computer,
   because restarting it requires that computer. Move the counter to the database if a second process or remote
   restarts are ever added.
5. Password reset is the recovery code (see "Recovery code"). Its pause counter is in memory, like the login pause
   (item 4), as approved. The owner should run `npm run recovery-code -- rotate` once and keep the code offline.
6. Pages are checked in the console layout. Server data added in later phases must also be checked in its own route
   (`withSession()`), as the plan requires, and not rely on the layout.
7. Tailscale identity headers (plan: "option to evaluate later") were not evaluated.
8. Phase 1 conditions still apply: M2 and L1 before Phase 4, L2 in Phase 4, L4 and I4 in Phase 10
   (`docs/phase1-schema.md`, "Review 2026-10-14").

## Future enhancements (not in Phase 2)

### QR sign-in for phones (deferred by the owner, 2026-10-15)

Intentionally deferred, not forgotten. **Not implemented in Phase 2 and not part of its scope**; it needs its own
approval before any work starts.

Goal: sign a phone in to an **existing** account by scanning a QR code shown on a laptop that is already signed in,
without typing the password on the phone.

Requirements:
- **Pairs with the existing account; never creates one.** The phone gets a normal session for the account that is
  signed in on the laptop. No new user, no shared or device account, and the same session rules apply (7 days idle,
  30 days absolute, ended by logout, disable or a password reset).
- **Short-lived, single-use challenge.** The phone opens the QR link and receives a random challenge (at least 128 bits,
  stored only as a hash, like session tokens) that expires after a short time, e.g. 2 minutes. It can be approved once
  and redeemed once; expired, used or refused challenges never work again.
- **Explicit approval on the signed-in laptop.** Scanning alone signs nothing in. The laptop shows the pending request
  (device and browser, time, a short matching code also shown on the phone) and a person must press Approve. Deny or
  no answer before expiry ends the challenge.
- **The secret stays with the device that asked.** The session is issued only to the phone browser that started the
  challenge (bound to a value held only by that browser), so a photographed or forwarded QR code cannot be redeemed
  elsewhere.
- **Same protections as sign-in:** same-site origin rule, rate limiting, audit entries with record IDs and error codes
  only (never the challenge, token or matching code), and refused for disabled accounts.
