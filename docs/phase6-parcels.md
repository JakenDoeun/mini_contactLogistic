# Phase 6 log: Parcels, Scan Parcel and Dashboard on the database

Branch `phase6-parcels` (from main `1250280`), commit `655b196`. Built and tested with synthetic data only, like Phases 4
and 5.

## Decisions (owner, 2026-10-19)

- **Dashboard is a hybrid**: one bar of today's arrivals by contact state on top, the work list ("Needs your attention")
  as the main part, and today's imports as a pipeline. The owner will say if it does not work, and it goes back to the
  work list alone.
- **No 7-day chart**: V1 excludes analytics.
- Parcels group and filter by their **Arrival Batch Date** (chosen in import review), never the import time.

## How it works

- **API**: `GET /api/parcels` (any signed-in staff) lists every stored parcel with its tracking code, recipient, phone,
  Arrival Batch Date, import time and source file name, newest arrival first. `PUT /api/parcels/<id>/phone` (any
  signed-in staff, cross-site refused, phone at most 40 characters, empty clears it) saves a staff phone edit through
  `editParcelPhone`, which writes `parcel_phone_changes` and the audit event `parcel.phone_edited`. An unknown parcel
  is 404.
- **Parcels and Scan Parcel** (`src/lib/mock/parcel-service.ts`) load the list from the API each time a page opens. A
  load error shows its reason with Try again instead of an empty page. A phone edit shows Saving… and stays open with the
  reason if the save fails.
- **Dashboard** (`src/components/dashboard/dashboard.tsx`):
  - *Today's arrivals*: a stacked bar from `dayProgress` (`src/lib/dashboard-logic.ts`): messaged or reached, at the
    gateway, SMS to retry, no phone number, not messaged yet. Every part also has an icon, a label and a count, never
    colour alone. With no arrivals today it links to Import Arrivals.
  - *Needs your attention*: the work list; files waiting in the watched folder come from `GET /api/folder`.
  - *Imports today*: rows in the file → Shopee rows → parcels → new, summed over today's confirmed imports
    (`GET /api/imports`), then why the rest were not added (already stored, left out in review) and the latest file.
- **Removed**: the sample import service, the preview modes and the old sample import logic. `import-logic.ts` keeps only
  the browser-side file rules.
- **Still in memory until Phase 9**: messages, calls and the SMS queue. They reset on reload, and the pages say so. Until
  then the Dashboard bar on real data shows only "no phone number" and "not messaged yet".

## Tests

- Unit: `listParcels` returns the stored fields with the source file name, newest arrival first (`parcels.test.ts`);
  grouping uses the Arrival Batch Date, not the import time (`parcel-logic.test.ts`); `dayProgress` counts each state
  once, the most settled state first, and only for the chosen day (`dashboard-logic.test.ts`).
- Integration (`test/integration/app.test.ts`): the route sweep finds every route by itself and refuses signed-out and forged sessions on the two new ones.
- API on a scratch build with one synthetic file imported: phone edit 200 and audited, too-long phone 400, unknown parcel
  404, signed out 401.
- Browser, scratch build (headless Chromium): Dashboard and Parcels at 1440 and 390 px wide with no horizontal overflow
  (two Dashboard cards overflowed at phone width in the first round; fixed and rechecked). `impeccable detect`: no
  findings.
- Totals on the branch: 163 unit, 17 integration, type check clean.

## Gate

Recorded, not ticked: ticks wait for the owner. The real-data part waits for the branch laptop (owner, 2026-10-19:
branch-laptop testing after all phases).

- [ ] A real camera scan on Scan Parcel finds a stored parcel and opens its phone group. Synthetic parcels are enough;
  this can be done on the dev server.
- [ ] One real day's export, after import, shows the right phone groups on Parcels for that Arrival Batch Date, and
  the Dashboard counts match.
