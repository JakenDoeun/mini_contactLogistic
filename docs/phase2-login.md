# Phase 2: login and sessions

Status: **implemented on branch `phase2-login` (2026-10-14), awaiting the owner's review. Not merged.** The Phase 2 gate
(the owner signs in on the laptop and a phone) has not been done. The Next.js security advisory review from Phase 0 is
still open, so **the security gate has not passed** (see `docs/phase0.md`, "Merge and follow-ups"). Synthetic data only;
no deployment.

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

## Routes

| Route | Signed out | Notes |
|---|---|---|
| `POST /api/auth/login` | public | 401 wrong credentials, 429 + `Retry-After` while paused, 403 cross-site, 400 bad body |
| `POST /api/auth/setup` | public while no account exists | 403 wrong code, 409 once an account exists |
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

## Open issues

1. **Security advisory review (Phase 0): not done.** Next.js 16.4.0 and TypeScript 6.0.3 remain provisional. The
   security gate has not passed.
2. **Phase 2 gate:** the owner signs in on the laptop and on a phone through the Tailscale address. Not done.
3. Login works through the branch address (Tailscale or `BRANCH_URL`) and on the office computer at `127.0.0.1` or
   `localhost`. The legacy Caddy LAN addresses are not accepted origins (and a plain-http LAN address cannot hold a
   Secure cookie). Set `BRANCH_URL` if Caddy must stay in use.
4. The login pause counter lives in the web process's memory and resets on restart (code comment). It is enough for one
   web process.
5. There is no change-password or reset screen. To reset, run `npm run user -- disable` and then `add` with a new
   username. This is a candidate for a later phase if the owner wants it.
6. Pages are checked in the console layout. Server data added in later phases must also be checked in its own route
   (`withSession()`), as the plan requires, and not rely on the layout.
7. Tailscale identity headers (plan: "option to evaluate later") were not evaluated.
8. Phase 1 conditions still apply: M2 and L1 before Phase 4, L2 in Phase 4, L4 and I4 in Phase 10
   (`docs/phase1-schema.md`, "Review 2026-10-14").
