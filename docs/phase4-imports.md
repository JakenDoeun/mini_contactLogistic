# Phase 4 log: imports

Branch `phase4-imports`, merged into main with Phase 5 on 2026-10-19 (`bdbeed8`, owner "merge approved"). Built and
tested with synthetic files only (owner, 2026-10-18): real courier files wait until the branch laptop passes the Phase 3
gate and the prerequisite below is recorded.

## Decisions

- Authorised 2026-10-18 (plan doc Revision 5). The rules are `docs/import-rules.md`: one file is one morning's arrival
  batch; only `Send Outlet` = `Shopee SHPE` rows count (rule `send-outlet-shopee-shpe/v1`); rows group into one parcel
  per tracking code; the arrival date is the Arrival Batch Date chosen in review, never the upload time.
- Review decisions can be changed until Confirm (decision 38, finding I3).
- The npm `xlsx` package (0.18.5) is outdated and has two advisories, so SheetJS 0.20.3 is vendored from
  cdn.sheetjs.com: `vendor/xlsx-0.20.3.tgz`, SHA-256 `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`,
  no dependencies, no install scripts.
- The server code lives in `src/server/importer/`, not `imports/`: `.gitignore` keeps every `imports/` folder
  (uploaded courier files) out of git. The one exception is the route folder `src/app/api/imports/`, where the local
  pre-commit hook lets through only `.ts` files.

## Prerequisites closed first

| Finding | Fix | Test |
|---|---|---|
| M2 | A production server without `DATA_DIR` is refused instead of using the development folder. `npm run start` and `start:lan` run `scripts/serve.ts`, which passes it. | `paths.test.ts` |
| L1 | The demo seed refuses production mode and compares real paths against the Linux and Windows production folders, so a symlink or bind mount cannot get it in. | `paths.test.ts` |
| L2 | Audit values take one shape per key: `counts` whole numbers, `rules` rule IDs, `arrival_dates` dates, `file_name` only the app's own backup files. A courier file name never reaches the audit log. | `parcels.test.ts` |

## How it works

- **Check** (`src/server/importer/check.ts`, no database): finds the format from the bytes (XLSX, XLSX named `.xls`,
  Excel 97 `.xls`, CSV kept as text). Headers are trimmed, case-insensitive and exact; `Send Outlet` must appear once
  or the check fails. It applies the Shopee rule, groups rows by tracking key (spellings, names and phones kept for
  staff), reads scan times as Phnom Penh time with the source text kept, and sorts parcels into database duplicate,
  left out, blocked and ready. A missing date choice is reported on its own, not as blocked.
- **Save and review** (`src/server/importer/store.ts`): a check stores the original once as `imports/<sha256>` (0600)
  in the data folder, plus an `imports` row (checked, no eligible rows, or failed with the reason) and its review items:
  recipient conflicts and code spellings (blocking), database duplicates, unreadable scan times. Nothing reaches
  `parcels`. Review re-reads the stored file and gives live counts for a date choice, the scan dates (already imported
  ones marked), earlier imports of the same file and why Confirm would refuse.
- **Confirm** is one `BEGIN IMMEDIATE` transaction that re-checks against the database as it is then. It refuses while
  anything is blocked, a date choice is missing, a scan date is not today without an explicit Arrival Batch Date, or a
  re-review picks a date already imported. It adds only new parcels with staff's choices plus every row's scan events,
  and audits counts only. A second Confirm adds nothing; an error rolls everything back and marks the import failed.
- **Same file again**: a warning, or refused when Settings say block (`import.duplicate_file`). A partly imported file
  can be re-checked for its remaining scan dates only.
- **Stored parcels are never changed** by an import: a case-only match is skipped, and staff phone edits, spellings and
  events stay. Retention keeps a stored file while any import still uses it.
- **API**: `POST /api/imports/check` (multipart, up to 10 MB), `GET /api/imports`, `GET /api/imports/<id>?choice=&date=`,
  `PUT /api/imports/review-items/<id>`, `POST /api/imports/<id>/confirm`, `POST /api/imports/<id>/cancel`. Every route
  checks the session; every change refuses cross-site requests; a decision must pick values the file offers. Upload
  names such as `C:\fakepath\x.xls` keep only the file name on every OS.
- **Import Arrivals** uses the real API: upload, the review sheet (row and parcel counts, each parcel with its state,
  conflicts and spellings with their decisions, the scan-date choice, the Arrival Batch Date, earlier imports), Confirm
  or Discard, history, latest import and today's totals. Any history row reopens its review. The Parcels page stays
  sample data until Phase 6.

## Tests

- Unit, check (`check.test.ts`): every `scan-record-mixed` format and the case/space header variant give the documented
  review (28 rows = 18 Shopee + 10 excluded, 10 parcels, 3 blocked, 7 ready); header fixtures fail and name the column; the
  outlet rule table; two scan dates; staff decisions; database duplicates; scan events.
- Unit, store (`store.test.ts`): the mixed file through review and Confirm; same file warn and block; the two-day
  re-review; the batch-date rule; failures and no Shopee rows (nothing written to `parcels`); stored parcels untouched;
  rollback on error and cancel; retention keeping a shared file.
- Integration (`test/integration/app.test.ts`, built app): signed out 401, cross-site 403; the `.xls`-named XLSX fixture
  uploaded as `C:\fakepath\Scan_record.xls` gives the documented review; an invalid decision is refused; Confirm adds
  the 7 ready parcels with today's Arrival Batch Date; a second Confirm 409; history shows it; a file without
  `Send Outlet` 422. The route sweep refuses signed-out and forged sessions on every import route.
- The real `Scan_record.xls` was checked in place, counts only, nothing stored: 114 rows = 89 Shopee + 25 excluded, 14 excluded codes,
  60 parcels, 29 collapsed, 0 blocked, one scan date, as `docs/import-rules.md` documents.
- At merge (clean clone of `bdbeed8`): 165 unit, 17 integration, type check, build, `npm audit --omit=dev` 0.

## Gate

Recorded, not ticked: ticks wait for the owner, and the real-data part waits for the branch laptop.

Synthetic part (shown by the tests above):

- [ ] The mixed-outlet sample (`scan-record-mixed`: Shopee SHPE with odd capitals and spaces, NBSP, blanks,
  `Shopee SHPE Extra`, `Shopee  SHPE`, other outlets) imports only its Shopee SHPE rows and every count matches.
- [ ] A file without `Send Outlet` and a file with no Shopee rows both import nothing.

Prerequisite, before any real customer data:

- [ ] On the branch laptop the app runs as the installer's `campusbranch` account with `C:\ProgramData\CampusBranch`
  open only to SYSTEM, Administrators and the app; checked and recorded. (Shown on the Windows test VM in Phase 3; to
  repeat on the laptop.)
- [ ] The Phase 3 gate passed on the branch laptop.

Real-data part, only after the prerequisite:

- [ ] One real export imported twice: the second is refused or warned as the same file, counts match.
- [ ] An overlapping export: parcels already stored are skipped, counts match.
- [ ] A backup taken right after includes them.
