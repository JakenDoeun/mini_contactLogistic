# Phase 11 log: acceptance

Branch `phase11-acceptance` (from main `5bd4a98`). Authorised by the owner on 2026-10-21 ("start phase 11"). The plan's
gate: the full acceptance table (plan doc, "Acceptance tests") on a small real day, then the owner approves going live.

A real day needs the branch laptop, the real gateway phone with the branch SIM, and a real export. None is available on
2026-10-21, so this phase starts by settling every row that can be settled now: automated tests, the Windows test VM
(`win10s`), and the Android Emulator on the owner's old laptop. The rows left are run on the real day.

## Where each row stands (2026-10-21)

Status: **pass** = a test or a recorded check covers it; **partly** = covered in part, the rest named; **finding** =
fails as written; **real day** = needs the branch laptop, the real phone or a real export.

| # | Area | Test | Status | Evidence or what is left |
|---|---|---|---|---|
| 1 | Imports | Real .xlsx, .xls, .csv sample files | pass | `scan-record-mixed.*`: the expected review from xlsx, xls (BIFF), xlsx named .xls and csv. Real export: real day |
| 2 | Imports | Unreadable file; missing tracking column | pass | "header problems: nothing is imported, and the message names the column"; "validateFile accepts exports and rejects other files" |
| 3 | Imports | Same file twice, renamed | pass | "the same file again: a warning by default, refused when Settings say block" (by fingerprint, not name) |
| 4 | Imports | Two files with overlapping codes | pass | "staff decisions unblock parcels; … stored keys are database duplicates"; "re-importing yesterday's file adds nothing" |
| 5 | Imports | Existing parcel with edited phone and history | pass | "re-imports never overwrite a parcel, its staff-edited phone or its phone history" |
| 6 | Imports | Crash in the middle of a confirm | partly | "an error during Confirm rolls everything back and marks the import failed". A killed process is covered by SQLite's transaction, not by its own test |
| 7 | Imports | File detected in the folder | pass | "scan: records finished exports once, never imports"; integration "Phase 5 gate"; VM 2026-10-21 (Scan Folder Now, then review) |
| 8 | Imports | File still being copied | pass | "scan: a file that grows while the scan waits is still being written" |
| 9 | Imports | File imported two days late | pass | "a scan date other than today: Confirm waits for an explicit Arrival Batch Date, which lands on every parcel" |
| 10 | Grouping | Same phone same day; same phone different days | pass | "groups by Arrival Batch Date, not import time" |
| 11 | Grouping | Same name different phones; different names same phone | pass | "groups by phone, never by name"; the group row lists every name (`phone-groups.tsx`) |
| 12 | Grouping | Several missing or invalid phones | pass | "a missing or invalid phone never groups, even with the same name" |
| 13 | Grouping | Add a phone to a missing-phone parcel | pass | "adding a phone number puts the parcel into its phone group" |
| 14 | Grouping | Search by code, name, phone; Scan lookup | partly | Scan lookup: fixed and tested in this phase (below). Search has no test of its own (inside the Parcels page): browser check on the VM |
| 15 | SMS | One eligible parcel; three on one phone | pass | "notify today's customers: one SMS per phone in today's batch only" |
| 16 | SMS | Already notified parcels; later arrival same day | pass | "a new arrival is messaged alone; earlier notified parcels are left out" |
| 17 | SMS | Double click and two tabs on Start queue | pass | "Notify today's customers: … the same request twice creates nothing" |
| 18 | SMS | Gateway offline, 400, 401, 503 | pass | offline and 503 wait as Queued ("an unreachable phone keeps the message waiting"); 401 fails it and pauses the batch; 400 fails it |
| 19 | SMS | Timeout after the request left | pass | "a send that times out is unknown, never failed"; "a hand-over with no answer is looked up by ID" |
| 20 | SMS | Failed SMS then reached call | pass | "a failed SMS then an answered call: SMS stays Failed". There is no contact status since 2026-10-20 (owner): the call is history |
| 21 | SMS | Gateway states Pending to Delivered | pass | Unit test; emulator over the tailnet 2026-10-22: 3-SMS batch (one combined) Delivered, gaps 34 s and 72 s |
| 22 | SMS | Restart app and worker mid-batch | pass | "after a crash: Sending the phone never got is Not sent, Accepted it has lost is Check phone; nothing is resent" |
| 23 | Deploy | Reboot the host | pass | VM 2026-10-21: app back in 141 s with nobody signed in. Queue resumes: 2026-10-22, a run started while the phone was away waited, then went out once the phone answered |
| 24 | Deploy | Backup and restore drill | pass | VM 2026-10-18 (217/217 parcels, integrity ok) and 2026-10-21 (restore, SMS hold, staff release) |
| 25 | Deploy | Device outside the allowed rule; staff phone | partly | 2026-10-22: gateway 8080 refused from the owner's laptop, open from the VM (`tag:office`); VM → gateway 22 refused. Staff phone opens the app: owner |
| 26 | Deploy | Browser source and API responses | finding | No password anywhere. The gateway's address is sent to every signed-in staff member by `/api/gateway` and shown in Settings (Phase 8). Owner to decide (below) |
| 27 | Phone | Test SMS through the SIM, Wi-Fi then mobile data | real day | Needs the real phone and branch SIM |
| 28 | Phone | Gateway phone reboot, airplane mode, low battery | partly | 2026-10-22: SMSGate stopped mid-morning → "Waiting for the gateway phone" and "has not answered since"; started again → both sent, 5 on the phone, none twice. Reboot: Phase 7 (emulator). Airplane mode, low battery: real phone |
| 29 | Phone | Camera scan on iPhone Safari and Android Chrome | partly | Owner scanned with a phone camera in Phase 6. Both browsers on the real day |
| 30 | Shopee filter | Mixed outlets, as .xlsx, .xls and .csv | pass | `scan-record-mixed.*` expected-review tests |
| 31 | Shopee filter | Capitals and surrounding spaces, NBSP | pass | "outlet rule send-outlet-shopee-shpe/v1"; "source values are trimmed of surrounding whitespace and NBSP only" |
| 32 | Shopee filter | Blank, missing, near-miss names | pass | outlet rule test; mixed fixture rows |
| 33 | Shopee filter | No Send Outlet column; two | pass | `headers-no-send-outlet.*`, `headers-two-send-outlet.*` |
| 34 | Shopee filter | File with no Shopee SHPE rows | pass | "files that cannot be imported: … no Shopee rows is its own status; nothing is written to parcels" |
| 35 | Shopee filter | Duplicates: in the database, twice in the file, non-Shopee sharing a code | pass | "a stored parcel is never touched"; mixed fixture (repeat rows collapse; non-Shopee row with a Shopee code) |
| 36 | Shopee filter | Same mixed file uploaded and from the folder | partly | Both paths tested (integration Phase 4 upload, Phase 5 folder); identical counts not compared in one test |

## Found and fixed

- **Scan lookup missed codes with a small letter or a space.** Scan upper-cased the scanned code and removed its
  spaces, then compared it with the stored spelling exactly, so `s000000018` or `SPX 123` was never found. Both sides
  are now normalized (`findByCode` in `src/lib/parcel-logic.ts`, tested).

## Emulator run, 2026-10-22

Android 14 emulator on the owner's old laptop (`homeserver`, Ubuntu 26.04, tagged `tag:gateway`), SMSGate 1.77.3
(checksum as in Phase 7), Local Server and Start on boot on, port 8080 shared on the tailnet with Tailscale Serve. The
app on the test VM (main plus Phase 11) was set up with `gateway set` to `http://homeserver.tailc4ca3f.ts.net:8080`:
"Connected, phone checks pass", Delete after set to 7 days, `gateway.json` readable by the app account, Administrators
and SYSTEM only. SMSGate's generated 8-character password was replaced with a random 24-character one (the old one then
got 401). Synthetic files only, imported through Scan Folder Now with no decisions needed. A temporary staff account
`claude.test` took the screenshots and was disabled afterwards; the emulator was stopped.

Not covered by the emulator: the SIM, the carrier, delivery reports (the emulator says Delivered for everything), battery
savers.

## Owner decisions

- **2026-10-22, gateway phone network.** SMSGate cannot be limited to the tailnet; on Wi-Fi it is also reachable from
  that Wi-Fi. The owner keeps the phone on the branch Wi-Fi (staff use; customers rarely and briefly; the password is
  never shared). Conditions in `docs/tailnet-rules.md`, "The gateway phone on the branch Wi-Fi".

## Owner decisions needed

- **Row 26, the gateway's address.** The plan says no gateway URL anywhere in the browser; Phase 8 shows the address
  in Settings to every staff member. The password never leaves the server, and the tailnet rules now stop staff
  devices reaching the phone. Choose: show the address to the admin only, or change the row to "no password; the
  address is shown in Settings".

## Next

- Emulator on the owner's old laptop (Linux, 8 GB), tagged `tag:gateway`: rows 23 (queue resumes), 25 (8080 refused),
  28 (reboot, airplane mode).
- Browser checks on the VM: row 14 (search), the new Notifications notes.
- Real day on the branch laptop: rows 1 (real export), 27, 28 (battery), 29, and the gate.
