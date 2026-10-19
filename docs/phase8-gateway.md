# Phase 8 log: the gateway adapter

Branch `phase8-gateway` (from main `8430e17`, with `phase7-gateway` merged in). Authorised by the owner on 2026-10-19
("approved"), to be built and tested on the Android Emulator (owner: "work and test on emulator"). Synthetic data only.

## Decisions

- **Built to the Phase 7 emulator results** (`docs/smsgate-verification.md`), not to the published API spec.
- **The address and password live in `gateway.json` in the data folder** (mode 0600), written only by
  `npm run gateway -- set` on the branch computer. Never the database or the Settings page (docs/phase1-schema.md, "When
  restricted configuration becomes mandatory"). Settings shows the status and sends the test SMS; it cannot change them.
- **Sent messages are deleted on the phone after 7 days** (owner, 2026-10-19; replaces Revision 4's 24 hours). The app
  sets SMSGate's "Delete after" (`log_lifetime_days`) to 7 at setup and keeps it there on every status check. Android's
  own SMS store keeps its copies until staff clear them; the app cannot delete them.
- **A test SMS is admin only** (it costs the branch SIM a message). Only the number's last three digits are kept, in
  the settings row `gateway.test_sms`; the audit event `gateway.test_sent` carries no number.

## How it works

- `src/server/gateway/smsgate.ts`: the client. `send` posts our own UUID; 202 and 409 (the phone already has that ID)
  are both "accepted"; a timeout is "unknown", never failed, and the caller looks the ID up instead of sending again;
  an unreachable phone is an error before anything left the computer. `lookup` returns the phone's states with their
  times, or null on 404. `health` reads the phone's checks (HTTP 500 = a check fails, "not ready") and the phone's clock
  from the Date header. `checkLogin` proves the password (health needs none). `ensureDeleteAfter` keeps 7 days.
  Numbers go out as `+855…`.
- `src/server/gateway/status.ts`: Settings' view: set up or not, reachable, password, the phone's checks, the clock
  difference (more than 10 minutes is flagged, Revision 4), "Delete after"; the test SMS and its refresh.
- `scripts/gateway.ts` (`npm run gateway -- set | show`): asks the address, username and password (hidden when typed),
  checks them with the phone, sets "Delete after", saves, and audits `settings.changed` with the key `gateway` only. A
  wrong password or an unreachable phone saves nothing unless `--save-anyway` is given. `show` never prints the
  password.
- API: `GET /api/gateway` (signed in), `POST /api/gateway/test-sms` (admin, cross-site refused), `GET
  /api/gateway/test-sms` (the test SMS's state now). Settings polls the test SMS every 2 seconds until it is delivered
  or failed, for at most 2 minutes.
- Settings: the browser-only gateway address and sending-number fields are gone; the SMS gateway card is on the server.
- Windows: run `npm run gateway -- set` as an administrator in the app folder with `DATA_DIR=C:\ProgramData\CampusBranch`,
  so the file gets the data folder's permissions. Not yet run on Windows.

## Tests

- Unit (`src/server/gateway/smsgate.test.ts`, against a fake SMSGate with the emulator's behaviour): the file is 0600
  and read back; send, the same ID again (409, nothing new sent), lookup, unknown ID, wrong password, "Delete after";
  a timed-out send is "unknown" and found by lookup; an unreachable phone; status with a phone clock 5 minutes ahead,
  a failing phone (HTTP 500) and a wrong password; a test SMS keeps only the last digits and its audit has no number.
- Integration: the route sweep refuses signed-out and forged sessions on the three new routes.
- Emulator, 2026-10-20: `npm run gateway -- set` against the scratch data folder: connected, "Delete after" changed from
  1 to 7 days, file 0600; a wrong password refused and nothing saved. Settings on a scratch build: Connected, phone
  ready, battery, clock matches, 7 days; Send test SMS to 012 345 678 went Pending → Processed → Sent → Delivered in
  2 s, the same states the phone lists. The emulator reports Delivered for every SMS, so delivery itself is still
  unproven until the real phone.

## Gate

- [ ] You see the test SMS go through from Settings, on the emulator (owner's choice for now).
- [ ] On the real phone with the branch SIM: the test SMS arrives on a staff phone, and the app shows the state the
  phone reports. Waits for the real phone, with the branch laptop.
