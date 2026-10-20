# SMSGate Local Server verification (Phase 7)

Procedure for testing the gateway phone's own Local Server before the production SMS queue (Phase 9) is built.
The published API spec (v1.77.3) describes the Cloud and private server; nothing here assumes the Local Server matches it.

**Rules for the test**: messages go only to staff-owned numbers; at most about 15 SMS in total; the gateway password is typed,
never pasted into files, chat or shell history; results are written into the table at the end.

## Setup

1. Gateway phone: Android with the branch SIM. Install SMSGate (github.com/capcom6/android-sms-gateway), enable **Local Server**,
   note its port and Basic Auth username/password. Battery optimisation off for SMSGate. Charger connected.
2. Same phone: Tailscale app signed in to the branch tailnet, approved, Always-on VPN on. Note its MagicDNS name.
3. Tailnet rule: only the office computer may reach the phone on the SMSGate port (admin console).
4. On the office computer:
   ```sh
   export GW=http://<phone-tailscale-name>:8080     # the phone's name and port
   read -r  GW_USER                                  # typed, not saved
   read -rs GW_PASS                                  # typed, hidden
   export TO='+855…'                                 # a staff-owned number
   ```
5. Open `$GW/docs` in a browser on the office computer and copy the real paths into the table (`/message` or `/messages`,
   the lookup path, the health path). Use those paths below; `$SEND` and `$GET` stand for them.

## Tests

| # | Test | Command or action | Record |
|---|---|---|---|
| 1 | Real API | `$GW/docs` | Paths, fields, auth scheme, response codes |
| 2 | Send with our ID | `ID=$(uuidgen); curl -s -w ' %{http_code}\n' -u "$GW_USER:$GW_PASS" -H 'Content-Type: application/json' -d "{\"id\":\"$ID\",\"phoneNumbers\":[\"$TO\"],\"textMessage\":{\"text\":\"Campus Branch gateway test 2\"},\"withDeliveryReport\":true}" "$GW$SEND"` | Code and body; SMS arrives from the branch number |
| 3 | Lookup by ID | `curl -s -u "$GW_USER:$GW_PASS" "$GW$GET/$ID"` every 10 s for 2 min | Exists? States and timing (Pending, Processed, Sent, Delivered, Failed) |
| 4 | Same ID again | repeat test 2 with the same `$ID` | 409, silent duplicate, or a second real SMS (= no idempotency) |
| 5 | Bad auth | test 2 with a wrong password, then with no `-u` | 401/403 and nothing sent |
| 6 | Health | `curl -s -u … "$GW<health path>"` | Path and fields vs the documented checks |
| 7 | Phone offline | airplane mode on, run test 2 with a new ID | What the computer sees; after airplane mode off, whether the SMS goes out later |
| 8 | Cut mid-request | run test 2 with `--max-time 1` while the phone is slow (or pull Wi-Fi right after sending) | Whether it was sent; whether lookup by ID shows it |
| 9 | Phone reboot | reboot, touch nothing, wait 5 min, run test 6 | SMSGate and Tailscale back on their own? Queued messages kept? |
| 10 | Background | battery saver on, screen off 1 hour, run test 2 | Still answers and sends |
| 11 | Long and Khmer | ~250-character Latin text; one short Khmer text | Parts, encoding, how status reports multipart |
| 12 | Delivery report | from tests 2 and 11 | Whether Delivered ever arrives on this carrier |
| 13 | Status after reboot | after test 9, look up test 2's `$ID` again (test 3's command) | Same final status as before the reboot, or gone |
| 14 | "Delete after" | in SMSGate settings set "Delete after, days" = 1; the next day look up test 2's `$ID` and check the app's message list. In `$GW/docs`, look for a delete path | What is removed and when; whether the app can delete a message itself |
| 15 | Phone's time | `date -u; curl -si -u "$GW_USER:$GW_PASS" "$GW$GET/$ID"` | Whether the answer carries the phone's time (a `Date` header or a time field) and how far it is from the computer's |

## Decide after the tests

- Same ID refused (409) **and** lookup by ID works: the planned safe-send design stands.
- No idempotency: never resubmit a request that may have reached the phone; timeouts go straight to Unconfirmed for staff.
- No lookup by ID: use the list endpoint or signed webhooks if they work; otherwise statuses stop at "Submitted", shown plainly.
- No recovery after reboot: daily phone check becomes a staff task; the health check warns before a batch starts.
- Status lost after reboot (13): the queue treats a message it cannot look up as Check phone, never as failed or resent.
- "Delete after" does not remove what it should (14): proposal for the owner: the app deletes through the API if it
  can, otherwise staff clear the phone's message list on a set day. **Decided 2026-10-19 (owner): delete after 7
  days**; the app sets it (Phase 8). Android's own SMS store is cleared by staff.
- No phone time in answers (15): proposal for the owner: the clock check compares the computer with internet time only.
- Several missing: revisit the gateway choice before Phase 9. A paid provider is never switched to automatically.

## Emulator results (2026-10-19)

Not the gate. No Android phone was available, so the owner chose the Android Emulator: SMSGate 1.77.3 (app-release.apk,
SHA-256 `a5803430f10a32dfbf35dcbcbeaca6503bf4a2c2cb6116e12448afbfc1c102e9`) on Android 14 (API 34, Google APIs, x86_64),
reached through `adb forward` instead of Tailscale. The emulator's modem reports every SMS as Delivered and the second
emulator received nothing, so anything about the carrier, delivery or the real SIM is still open. The real-phone table
below stays empty until the branch phone is tested.

| # | Emulator result |
|---|---|
| 1 | `GET /docs/swagger.json` (Basic Auth). Paths: `POST /messages` (202, 400, 409), `GET /messages/{id}`, `GET /messages` (`state`, `from`, `to`, `limit`, `offset`), `DELETE /messages/{id}` (cancels Pending only), `GET /health`, `GET/PATCH /settings`, `/webhooks`, `/logs`, `/inbox`. `GET /health/ready` is 404 although documented. `POST /messages` takes `?skipPhoneValidation=true`. |
| 2 | 202 with the message and our `id`, state Pending. Unrealistic numbers (`+1555…`) are accepted with 202, then Failed with `sendSMS: Invalid phone number`, not refused with 400. |
| 3 | Works. Pending → Processed → Sent → Delivered in about 2 s, each state with its time (`states`). Unknown ID: 404, empty body. |
| 4 | 409 `{"message":"Message with the same ID already exists"}`; no second SMS (Android's sent store holds exactly one per accepted request). |
| 5 | Wrong or no password: 401 on send and lookup, nothing sent. `GET /health` needs no password. |
| 6 | `GET /health`: `status` pass or fail, `version`, checks `messages:failed` (last hour), `connection:status`, `connection:transport`, `connection:cellular`, `battery:level`, `battery:charging`. A failing check gives HTTP 500, not the documented 503. |
| 7 | Airplane mode: health fail (500, connection 0). A send is still 202, then Failed at once with an unrelated Android permission error. It is not kept or retried after airplane mode is off. |
| 8 | Client gave up after 5 ms with no answer: the message was still queued and delivered, and lookup by ID found it. |
| 9 | After `adb reboot`, untouched: the Local Server answered 30 s after boot (Start on boot on). A message held as Pending survived the reboot and was sent once the service ran again. |
| 10 | Unplugged, battery saver on, screen off, forced deep Doze, SMSGate not exempt from battery optimisation: answered in 9 ms and sent at once. Phone makers' own battery killers are not emulated. |
| 11 | 250 Latin characters: 2 parts, one status for the message. 30 Khmer characters: 1 part (Unicode, up to 70 characters per part), text returned intact. |
| 12 | Not testable: the emulator fakes Delivered. |
| 13 | Same final status after the reboot (Delivered stayed Delivered, Pending stayed Pending). |
| 14 | "Delete after, days" is in the app (Settings → Messages, default Not set) and in the API (`PATCH /settings` `{"messages":{"log_lifetime_days":1}}`). With the phone clock moved 2 days on, SMSGate removed every older message at its next send; lookup then gives 404. The app cannot delete a sent message (`DELETE` refuses anything not Pending). **Android's own SMS store keeps every sent SMS, number and text, whatever this setting says**; on a real phone they show in the Messages app. |
| 15 | Yes: every response, including `/health` without a password, has an HTTP `Date` header from the phone's clock, and message times carry the phone's offset (`+07:00`). With the phone clock moved 2 days on, both followed it. |

Also seen:

- Default processing order is LIFO (newest first). The planned queue sends one message at a time, so it does not matter,
  but FIFO can be set (`processing_order`).
- Work hours are a trap: switching them off through the API left even new messages Pending until the old start time;
  Stop and Start Service in the app cleared it. The app should not use work hours.

What this means for the design (proposals for the owner; confirm on the real phone):

- Same ID refused (409) and lookup by ID works: the planned safe-send design stands. After a timeout, look the ID up;
  never send under a new ID while the old one might exist.
- In both Failed cases seen (bad number, no network) the SMS never left the phone, and the phone never retries it. The
  queue could retry under a new ID after the health check passes; a carrier refusal on the real phone may differ.
- Health answers without a password, so the tailnet rule (setup step 3) matters. The queue checks health before a batch
  and treats HTTP 500 as "phone not ready".
- The clock check can read the phone's `Date` header from `/health`.
- New open question: the phone's own Messages app keeps every sent SMS. Clearing it needs a staff step, or a Messages app
  with automatic deletion, or acceptance by the owner.

## Results (real phone)

| # | Result | Notes |
|---|---|---|
| App version / Android version / carrier | | |
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | |
| 9 | | |
| 10 | | |
| 11 | | |
| 12 | | |
| 13 | | |
| 14 | | |
| 15 | | |
