# Phase 12 log: one dual-SIM gateway phone, SMS by carrier

Branch `phase12-dual-sim` (from `phase11-acceptance`). Authorised by the owner on 2026-10-23 ("build now, one real
day"), from the proposal doc "Dual-SIM SMS by carrier" (Claude Doc), which the owner reviewed. Extras chosen: sound
when a run ends, progress in the browser tab.

## What it does

- **Carrier from the number.** `src/lib/carriers.ts` holds the TRC mobile prefix list (read 2026-10-22). A number's
  first three digits give Cellcard, Smart, Metfone or Seatel; anything else is unknown.
- **SIMs from the phone.** SMSGate's `GET /device` lists the phone's SIMs (slot, carrier name, own number when the
  carrier stored it). The app scans when Notify opens, before each hand-over, when Settings › SMS gateway opens, and on
  **Scan SIMs**. Kept in setting `sms.sim_scan`.
- **Staff confirm each SIM once** (any signed-in staff member, owner's choice; audited as `gateway.sim_confirmed`
  with the carrier only). The scan suggests the carrier from the SIM's name, else from its own number. A SIM is "the
  same SIM" while its slot, carrier name and reported number stay the same; a swapped SIM counts as new and is unused
  until confirmed. Kept in setting `sms.sim_carriers`.
- **No fallback SIM** (owner, 2026-10-23). A customer whose carrier has a confirmed SIM in the phone now gets the SMS
  from that SIM (`sms_attempts.sim_number`, migration 0004). Everyone else is on **Contact by hand** (Notifications),
  each with the same card as the parcel page: **Call** (asks "Did the customer answer?"), **Telegram** (copies the
  message, asks if it was sent) and **SMS** (owner, 2026-10-23: opens the device's own messaging app with the number and
  message filled in, `sms:` link, then asks "Did you send the SMS from your phone?"; saved as contact channel `other`).
  A customer told by Telegram or SMS leaves the list; "no answer" stays with its time. The parcel page has the SMS
  button too.
- **Server enforces it.** `/api/sms/batch` and `/api/sms` route by a fresh scan (the last scan when the phone cannot
  be asked); a carrier with no SIM is refused `no_sim` or left out (`byHand` count).
- **A SIM taken out during a run:** its SMS wait (setting `sms.sim_missing`), the others go on; staff can put it back or
  press **Contact them by hand instead** (cancelled as `sim_missing`, never sent).
- **Two failures in a row on one SIM** (a call on it, no credit, blocked) pause the run (setting `sms.sim_pause`) until
  someone presses Resume. Nothing is resent on its own.
- **Counts:** the Ready panel ("5 by SMS · 3 to contact by hand", then customers per carrier: Cellcard 3 · SMS from
  SIM 1, Metfone 2 · by hand, …), Import Arrivals ("Today's customers by carrier", and in each import's review the
  customers the file brings, by carrier), the Notify panel (carrier table: customers and how
  they are told), the queue ("SIM 1: 9 of 15 · SIM 2: 6 of 10"), History ("SMS · SIM 2", filter "Other phone").
- **Test SMS** (admin, as before): By carrier (says what it would do before sending, sends nothing for a carrier with no
  SIM), from SIM 1, from SIM 2, or from each SIM (sent one after the other). The text names the SIM: "Campus Branch
  test from SIM 2 (Smart). No reply needed."
- **Sounds and tab title** on the Notifications page: a rising two-note chime when a run finishes; three short beeps
  when it needs someone (SIM pause, phone away over 5 minutes, SIM missing, a new failure), again every 30 s up to 5
  times until someone clicks or types. Made by the browser (Web Audio), no files. **Settings › Sounds on this device**:
  on/off, volume, test buttons, kept in this browser only; on by default. The tab reads "(3/5) Sending", "Done" or
  "Needs attention".
- **Notifications tabs** (owner, 2026-10-23): **Today** (attention, sending queue, Ready), **Contact by hand** (today's
  arrivals only; an earlier day's customers show when that day is reviewed) with the number waiting on the tab, and **History**. `?tab=by-hand` / `?tab=history` keep the tab through a reload; a history
  filter link opens History.
- **Contact by hand, working the list** (owner, 2026-10-23): pick a network (remembered per device) with "not
  contacted" and "no answer" counts, today's progress, never-tried numbers first; each row leads with the phone number,
  one slim Call · Telegram · SMS group, a light highlight on the row in use. **Double-check a parcel** (optional, never
  required): scan with the camera or a USB scanner, or type, to see whose parcel it is; a match is highlighted ("1 of
  2 parcels checked"), anything else says why it is not on the list (`checkByHand`, tested).
- Customer replies are ignored: the app never reads the phone's received messages (owner, 2026-10-23).

## Checks (2026-10-23)

- Unit: 203 pass (new: carriers, SIM scan/confirm, routing, missing SIM, pause after two failures, release, test SMS
  by carrier / per SIM / both, contact `other`). Integration: 20 pass (new: scan, staff confirm, Notify split, `other`
  contact through the real API against a stand-in SMSGate). `tsc` clean, `next build` in a clean clone.
- Browser, built app with a stand-in dual-SIM SMSGate (Cellcard slot 1, Smart slot 2) and 8 test customers on four
  carriers: scan suggested both carriers; staff confirmed them; Notify split 5 SMS (SIM 1: 3, SIM 2: 2) and 3 by hand;
  each SMS went from its SIM; "SMS from another phone" took that customer off the list; tab title "(1/5) Sending";
  admin test "From each SIM" sent one from each; no sideways scrolling at 390 px.
- `npm audit`: the registry's audit endpoint returned an error on 2026-10-23; no package was added in this phase.

## Left for the real day

- One dual-SIM Android phone with the two chosen carriers; SMSGate's Phone permission; call blocking on both SIMs.
- Real-day rows from the proposal: Both-SIMs test to the owner's phone (each Delivered, each from its own SIM's
  number); take SIM 2 out during a run. The exact carrier names Android reports are seen there for the first time.
- The emulator has one SIM, so dual-SIM behaviour was checked with a stand-in SMSGate, not the real app.
