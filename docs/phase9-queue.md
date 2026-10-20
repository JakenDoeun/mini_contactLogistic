# Phase 9 log: the notification queue

Branch `phase9-queue` (from main `379f914`). Authorised by the owner on 2026-10-20 ("start phase 9"), built and tested
on the Android Emulator like Phase 8. Synthetic data only.

## Decisions

- **Built to plan Revision 4**: one message per phone line per arrival day, with one ID and one status shared by its
  parcels; one message handed to the phone at a time; nothing is ever resent automatically.
- **Calls and Telegram are history entries** (owner, 2026-10-20), stored in `contact_attempts` as `reached`,
  `no_answer` or `messaged`. A call that reached the customer stops the SMS for those parcels, also one that is already
  queued: the worker cancels it before it goes. Revision 4's "no contact attempts" no longer applies.
- **"Notify today's customers" sends today's arrivals only. An earlier day goes as its own batch, after review**
  (owner, 2026-10-20). Notifications lists earlier days with customers never messaged, each with Review. The review
  warns that the parcels arrived before today and that customers may have collected them or been told another way, and
  the send button stays off until staff tick "I checked these customers and they still need this message". The server
  refuses an earlier day without that tick, and every line in a batch must be that one day, so today's and an earlier
  day's messages never mix. One batch at a time: a new one is refused while another is sending or paused. A single SMS
  from the parcel card still works for any day.
- **The browser sends the exact messages staff saw**, and the server re-checks each one inside one BEGIN IMMEDIATE
  transaction: same phone line, one arrival day, today, not messaged, not reached, nothing waiting. A line that changed
  meanwhile is skipped, never sent twice. One request key per opening of the confirm dialog, so a double click or a
  retried request creates nothing. The message templates are still browser settings, which is why the server does not
  write the text itself.
- **A retry with unchanged text and parcels is a new attempt of the same message** (Revision 4); an edited retry is a
  new message (reason `resend`). Only Failed or Check phone (Unconfirmed) messages can be retried.
- **A random gap of 25 to 80 seconds between two SMS** (owner, 2026-10-20), so the branch SIM's traffic looks like a
  person's and is less likely to be flagged or blocked. It applies to every SMS, single ones too, and still counts from
  the last hand-over after a restart. A run of 40 customers takes about 16 to 52 minutes; the confirm dialog says so.
- **Replies are not tracked** (owner, 2026-10-20). Messages do not ask for a reply, and the app does not read, store or
  mark replies; a customer who replies anyway is handled by hand from the gateway phone's Messages app.
- **The worker runs in the launcher** (`npm run serve`) beside backups, every 2 seconds, and holds the `worker_lease`
  row, so a second copy never sends. `npm run sms-worker` runs the same worker beside `npm run dev`.
- **After a restore, nothing is sent until staff check the gateway phone** (owner, 2026-10-20, option 2 of 2). Messages
  sent after the restored copy are missing, so their customers look not messaged. `npm run restore` sets the hold
  (`sms.restore_hold`, with the copy's time). Notifications shows the steps: open the phone's Messages app, look at what
  was sent since that time, tick each listed customer the phone shows a message for, then tick "I checked the gateway
  phone's sent messages" and resume. Ticked customers are saved as Sent ("seen on the gateway phone after a restore"),
  so they are never messaged twice; the hold is lifted in the same transaction. Until then the server refuses every new
  SMS and batch and the worker hands nothing over (it still asks the phone about messages already there).
- **History is deleted with its parcels** by the retention job (1–14 days, default 7). The phone keeps 7 days.

## How it works

- `src/server/sms/queue.ts`: `queueMessage` (one SMS from a parcel card or a retry), `notifyToday` (the batch),
  `controlBatch` (Pause, Resume, Stop; Stop cancels only messages still waiting), `recordContact` (calls and Telegram),
  `listContactEvents` (each message's latest attempt, as the pages show it), `latestBatch`, and the restore hold
  (`holdAfterRestore`, `restoreHold`, `releaseRestoreHold`). `notifyDay` is the batch, for today or one earlier day.
- `src/server/sms/worker.ts`, one round:
  1. On start, before anything new: Sending with no record on the phone becomes **Not sent**; Sending the phone cannot
     be asked about becomes **Check phone**; Accepted with no record on the phone becomes **Check phone**, never Not
     sent.
  2. Ask the phone about Accepted and Sent messages (every 3 s for the first 2 minutes, then every 30 s; Sent is left
     alone after an hour, since a delivery report is not coming). Processed for over an hour becomes Check phone.
  3. Hand over the oldest waiting message, unless one is already being handed over or its batch is paused. Sending is
     saved first. 202 or 409 is Accepted. No answer in time: look the ID up; the phone has it, so it is Accepted; the
     phone does not have it, so it waits and goes again under the same ID (the phone refuses a repeated ID); the phone
     cannot be asked, so Check phone. An unreachable phone, or one that answers 503, leaves the message waiting. A
     refused password fails it and pauses every running batch. Any other refusal fails it.
- API: `POST /api/sms`, `POST /api/sms/batch` (with the day and, for an earlier day, `checked`), `POST
  /api/sms/batch/<id>` (pause, resume, stop), `POST /api/sms/restore-check`, `POST /api/contacts`; `GET /api/parcels`
  now also returns the contact log, today's batch and the restore hold. All need a session and refuse cross-site
  requests.
- Browser: `src/lib/parcel-service.ts` (moved out of `mock/`) loads the log from the server, every 2.5 s while
  something waits at the gateway and every 20 s otherwise. The "Simulated" labels are gone from the parcel card and
  Notifications. The sending queue has Pause, Resume and Stop. The parcel card, Retry and Notify show the server's
  refusal in words.

## Tests

- Unit (`src/server/sms/sms.test.ts`, with a fake phone that counts every hand-over): one SMS per line, a second one
  while it waits refused, another number and two days refused; the batch takes today's lines only, skips a reached
  customer, and the same request key twice creates nothing; one hand-over at a time through to Delivered; after a
  crash, Not sent and Check phone as above, with nothing resent; a lost answer looked up, then sent again under the same
  ID; an unreachable phone, a refused password (batch paused) and Stop; a call that reached the customer after queuing
  cancels the SMS; a retry is a new attempt of the same message, an edited one a new message; a second worker does not
  send while the first holds the lease; an earlier day refused without the tick, sent as its own batch with today's
  line left out, and a second batch refused while one runs; after a restore every SMS, batch and hand-over waits, a
  customer ticked as seen is saved as Sent and never messaged again, and a refused line in the check saves nothing.
- Emulator, 2026-10-20, on a scratch data folder with synthetic parcels: a batch of 3 (one combined SMS for 3 parcels)
  went out one at a time and all reached Delivered; the same request key again created nothing; a message left at
  Sending by a simulated crash became Not sent, nothing was resent, and staff sending it again sent it once. The phone
  held exactly the 4 messages the app handed over, each once. The emulator reports Delivered for every SMS.
- Headless Chromium on the scratch build (1440 and 390 wide, no browser errors, no sideways scroll): Notify today with 2
  SMS through to Finished; an earlier day's Review with its send button off until the tick, then sent as its own batch
  and Delivered; after setting the hold, the banner, Resume off until the check is ticked, one customer ticked as seen
  (saved as Sent) and the other still to notify once the hold was lifted.

## Open

- The Notifications history still has its date filter; Revision 4 says today only. Unchanged for now.
- To watch it in development: `npm run dev` plus `npm run sms-worker`; the development data folder's gateway points at
  the emulator, which has no SIM.

## Gate

- [ ] A three-message batch to staff phones from the real phone with the branch SIM.
- [ ] The Revision 4 SMS failure tests (plan, "SMS failure tests"), on Windows. Each checks that SMS received equals
  SMS marked Sent and that nobody got a duplicate.
