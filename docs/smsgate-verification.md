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

## Decide after the tests

- Same ID refused (409) **and** lookup by ID works: the planned safe-send design stands.
- No idempotency: never resubmit a request that may have reached the phone; timeouts go straight to Unconfirmed for staff.
- No lookup by ID: use the list endpoint or signed webhooks if they work; otherwise statuses stop at "Submitted", shown plainly.
- No recovery after reboot: daily phone check becomes a staff task; the health check warns before a batch starts.
- Several missing: revisit the gateway choice before Phase 9. A paid provider is never switched to automatically.

## Results

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
