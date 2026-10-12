# Import rules: company "Today" scan export, Shopee only

Required for every import (plan Revision 3, Phase 4). Implemented in Phase 4; this is the specification its tests check.
Revision 2026-10-12d: arrival batch date chosen in the review; scan types not interpreted; scan times read as Phnom Penh time;
tracking codes matched case-insensitively; partly imported files can be re-reviewed. Decisions: table at the end.

**MUST (Phase 4):** the server filters every import to rows whose `Send Outlet` is `Shopee SHPE` (rule below). If the file has
no `Send Outlet` column, or has it twice, the import check fails and nothing is imported. There is no fallback that imports all
rows, no setting that turns the filter off or changes its column or value, and no client-side filtering in its place.

## What the file is

The company system has a "Today" section listing the parcels scanned during the morning parcel-arrival scanning. The operator
exports that section as an Excel file (for example `Scan_record.xls`) and imports it here. So one file = one day's arrival
batch, not a history of all parcels. The file has one row per scan event, so a parcel can appear on several rows; these are
consolidated into one parcel record each.

## Field mapping (company `Scan_record` export)

| Field | Source header (default) | Configurable in Settings | Required | Use |
|---|---|---|---|---|
| Tracking code | `scan order number` (decided 2026-10-12) | yes | yes | parcel identifier (rule `tracking-code-key/v1`) |
| Recipient name | `consignee name` | yes | yes | parcel record |
| Phone | `consignee mobile` | yes | yes | parcel record |
| Event timestamp | `scan time` | yes | yes | scan-event metadata; scan dates |
| Scan event type | `scanTypeDesc` | yes | no | scan-event metadata only, never interpreted |
| Upload timestamp | `Upload Time` | yes | no | scan-event metadata only |
| Outlet filter | `Send Outlet` = `Shopee SHPE` | **no, fixed** | yes | filter |

- Header matching for every field: trimmed, case-insensitive, exact. A required header that is missing, or any mapped header
  found more than once → the check fails, naming the column, and nothing is imported. A missing optional header → the review
  notes it; those metadata fields stay empty.
- All cells are read as text; the original cell text of every mapped field is kept.
- Current Settings defaults (`trackingColumn: 'Tracking code'`, `phoneColumn: 'Phone'` in `src/lib/settings-logic.ts`) change to
  the table above in Phase 4.

## Rule `send-outlet-shopee-shpe/v1`

- **Column**: the header that, trimmed and compared without regard to capitals, equals `Send Outlet`.
  - No such header → the check fails: "This file has no Send Outlet column, so Shopee parcels cannot be identified. Nothing was imported."
  - More than one such header → the check fails the same way (ambiguous).
  - Never a fallback to importing all rows.
- **Row**: include only when the cell, after trimming surrounding whitespace (including non-breaking spaces) and lower-casing,
  equals `shopee shpe`. Exact comparison: no substring, prefix or fuzzy matching; inner spaces must match.
- Applied on the server, inside the one import check used by manual uploads and watched-folder files, **before** consolidation,
  duplicate checks and before any parcel record can be created. The browser never decides which rows count. Cannot be disabled.
- Excluded rows are only counted: they are never stored, and their tracking codes are not checked against the database. A code on
  an excluded row does not join the Shopee parcel with the same code.

| Value in `Send Outlet` | Result |
|---|---|
| `Shopee SHPE` | include |
| ` shopee shpe ` | include |
| `SHOPEE SHPE` | include |
| `Other Outlet` | exclude |
| empty or missing cell | exclude |
| `Shopee` | exclude |
| `Shopee SHPE Extra` | exclude |
| `Shopee  SHPE` (two inner spaces) | exclude |

## Rule `tracking-code-key/v1`

- **Stored and shown**: the tracking code exactly as in the file after trimming surrounding whitespace. Letters and their case,
  internal spaces and leading zeros are kept; the code is never converted to a number.
- **Matching key**: the stored code with ASCII letters `a–z` upper-cased and nothing else changed (internal spaces, leading
  zeros, punctuation and other characters stay; `AB 12` stays `AB 12`). The key is used
  for grouping rows into parcels, duplicate detection against the database, and lookups (Scan Parcel, search). It is unique in
  the database, so codes differing only by letter case never become two parcels.
- **Ambiguous spelling**: rows of one parcel in the same file whose codes differ only by case (`S000000018`, `s000000018`) form
  one parcel, blocked until staff pick the spelling to store. A file code that matches a stored parcel only by key (different
  case) is a database duplicate: skipped like any other, and listed as "matched ignoring case".

## Rule `scan-time-local/v1`

`scan time` and `Upload Time` carry no time zone. They are read as **Asia/Phnom_Penh** local time (UTC+7, no daylight saving);
this assumption is recorded with each import. The original cell text is stored unchanged; a parsed UTC timestamp is stored beside
it when the text is a valid `YYYY-MM-DD HH:MM:SS`. A row's scan date is the date part of its source text. Unparseable values keep
their text, get no parsed time and no scan date, and are listed in the review. Valid means exactly `YYYY-MM-DD HH:MM:SS` naming a
real date and time (`2026-02-30 10:00:00` and `2026-10-10 25:00:00` are not); other formats, numeric spreadsheet date serials
and empty cells are unreadable. An unreadable value is never used as an event time, for ordering, for the earliest scan date
or for the scan-date-differs-from-today check. Storage: `docs/phase1-schema.md` (`parcel_scan_events`).

## Rule `arrival-batch-date/v1`

1. The review has an explicit **Arrival Batch Date**, defaulting to today's date in `Asia/Phnom_Penh` (the company's "Today"
   batch). The operator can pick another date when importing an earlier batch late.
2. **Scan date differs from today**: the review shows a warning (for example "Scanned on 2026-10-10; today is 2026-10-11") and
   Confirm stays disabled until the operator chooses the batch date explicitly: keep today, or pick another date. The scan date
   may be offered as a choice but is never substituted automatically.
3. Every new parcel from the confirmed import gets the chosen date as its arrival date. The import record stores it, and whether
   the operator changed it from the default.
4. Never the arrival date: `Upload Time`, the time the file is imported, or anything inferred from `scanTypeDesc`.
5. **Several scan dates**: if the Shopee rows' scan dates (rule `scan-time-local/v1`) are not all the same, the review shows
   parcels per scan date and requires a choice before Confirm: either "all of these parcels arrived on <Arrival Batch Date>"
   (explicit tick), or "import only parcels scanned on <date>" (the rest are left out and counted). Nothing is silently assigned.
   A parcel whose own rows span two dates counts under its earliest scan date. Rows with unparseable scan times are listed and
   need the same choice.
6. **Re-review of a partly imported file**: whole-file duplicate protection (warn or block per Settings) stays for ordinary repeat
   imports. The one exception: when an earlier import of the same file (same SHA-256) deliberately imported only some scan dates,
   the file can be checked again. The review states which scan dates were already imported, when, by whom and how many parcels;
   only the remaining scan dates can be chosen. Parcels already created are database duplicates and are skipped as always. Once
   every scan date of the file has been imported, the normal duplicate-file protection applies again.

## Rule `scan-events-to-parcels/v1`

1. **Group** the Shopee rows by tracking-code key. One group = one parcel. Repeat rows of a code are collapsed, not counted as
   in-file duplicates.
2. **Not conflicts**: differences in scan type, scan time, scan site, upload time or any other column.
3. **Conflict**: within a group, recipient name or phone differs after normalising. Names: surrounding whitespace trimmed, inner
   whitespace collapsed to one space, compared case-insensitively; differences removed by this are not conflicts
   (` test customer q ` = `Test Customer Q`). Phones: compared after `normalizePhone`. A conflict blocks the parcel; no row is
   picked automatically. Staff choose the name and phone from the values shown, or leave the parcel out of this import.
4. **Scan types are not interpreted**: `Delivery`, `arrived` and `Whole package to piece scanning` are stored as text. Their
   meanings are unconfirmed, so no parcel status (delivered, received, collected, …) or arrival date is derived from them.
5. **Metadata kept**: for every Shopee row of a new parcel, its scan type, scan time (source text and parsed UTC), scan site and
   upload time are stored as that parcel's source scan events, separate from the arrival date.
6. **Existing records**: a key already in the database is a database duplicate and is skipped. Nothing in an existing parcel is
   changed: not its code spelling, name, phone (including staff-edited phones), arrival date, SMS history or contact history, and
   no scan events are added to it. If the file's name or phone differs from the stored one, the review lists it for information.

## Order of the import check

1. Whole-file SHA-256 against earlier imports: warn or block per Settings, except a re-review of a partly imported file (rule
   `arrival-batch-date/v1`, point 6).
2. Format from the file's bytes, not its name: XLSX (zip), legacy Excel 97 `.xls` (OLE), or CSV. The company export is XLSX
   saved as `.xls`.
3. Headers: every required mapped column present once; `Send Outlet` present once.
4. Outlet filter.
5. Group Shopee rows into parcels by key; find recipient conflicts and ambiguous spellings; parse scan times; check scan dates.
6. Keys already in the database.
7. Review: Arrival Batch Date, staff resolve what is blocked, explicit Confirm. Confirm writes new parcels and their scan events in
   one transaction.

## Review, confirmation and history

Rows and parcels are counted separately, and each number has one meaning:

| Count | Unit | Meaning |
|---|---|---|
| Source rows | rows | data rows in the file = Shopee rows + excluded rows |
| Shopee SHPE rows | rows | rows kept by the outlet filter |
| Excluded rows (not Shopee) | rows | rows dropped by the outlet filter; never stored |
| Excluded codes | codes | distinct keys on excluded rows; information only: never parcels, never checked against the database |
| Repeat rows collapsed | rows | Shopee rows − unique parcels |
| Unique parcels | parcels | distinct keys among Shopee rows = database duplicates + left out + blocked + ready |
| Database duplicates skipped | parcels | key already stored; skipped, existing record untouched (case-only matches marked) |
| Left out | parcels | left out by staff, or not on the chosen scan date |
| Blocked, needs staff | parcels | recipient conflict or ambiguous code spelling, not yet resolved |
| Ready to import | parcels | new parcels that Confirm would create now |

Each unique parcel is counted in exactly one of the last four, checked in that order: database duplicate, left out, blocked,
ready. Confirm is refused while "Blocked" is above zero or a required date choice is missing. After Confirm, "Ready to import" is
the number of parcel records created.

The review also shows the Arrival Batch Date (and whether it was changed from today), the scan dates found with parcels per date,
the scan-date-differs-from-today warning when it applies, earlier imports of the same file (re-review), the itemised conflicts,
spellings, database duplicates and unparseable scan times, and the rule IDs (`send-outlet-shopee-shpe/v1`,
`tracking-code-key/v1`, `scan-time-local/v1`, `arrival-batch-date/v1`, `scan-events-to-parcels/v1`) with the headers as found.
All of it is saved with the import.

Confirm is an explicit staff action. Files found in the watched folder are only checked and queued for review; they are never
imported without that confirmation. No eligible rows: the review says so, Import is disabled, the confirm endpoint refuses,
history status `no_eligible_rows`, zero parcels created. Counts are computed from each file; nothing expects fixed numbers.

## Real export: `Scan_record.xls` (checked 2026-10-12)

The company-provided export was read in place; it contains real customer names and phones, so it is **not** committed
(`*.xls` is ignored outside `test/fixtures/`). Findings:

- **Format**: XLSX content (zip, Excel 2007+) saved with an `.xls` name. One sheet (`Sheet1`), header in row 1, 114 data rows.
- **Headers** (A–Z, exact): `scan order number`, `Data Source`, `scanTypeDesc`, `scan time`, `scan person`, `scan site`,
  `Up/Next Site`, `Receiver/Dispatch Member`, `Upload Time`, `Send Outlet`, `Destination Outlet`, `number of pieces`, `weight`,
  `netWeight`, `payment on arrival`, `collected payment`, `item type`, `consignee name`, `consignee mobile`, `consignee address`,
  `␠Remarks` (leading space), `signMan`, `isRefundDesc`, `problemReason`, `customerCodeDesc`, `customerCode`.
- **Cells are text** (number format 49), except the numeric columns L–P. All 114 tracking codes are text cells.
- **Send Outlet**: column J, header exactly `Send Outlet`. `Shopee SHPE` exactly (no extra spaces) on 89 rows; excluded 25:
  `Taobao ZTO PP transit warehouse` 13, `ZTO Guangzhou International Warehouse` 6, `Siem Reap Province SRP-01` 4, blank 2.
  `customerCodeDesc` carries the same value, but the rule uses `Send Outlet` only.
- **`scanTypeDesc` values** (exact): `Delivery` 72, `arrived` 40, `Whole package to piece scanning` 2. Shopee rows: `Delivery` 60,
  `arrived` 29. Meanings unconfirmed.
- **Tracking codes**: 14 digits, or a letter plus 9 digits on the 2 split rows. No leading zeros, internal or surrounding spaces,
  and no two codes differing only by case in this sample. The 2 split rows have distinct codes, appear nowhere else, and have no
  outlet, name or phone (so they are excluded). No code appears on both a Shopee and an excluded row.
- **Repeat events**: the 89 Shopee rows hold 60 parcels: 29 with an `arrived` and a `Delivery` row, 31 with only `Delivery`.
  Name and phone identical within every parcel (0 conflicts). Scan site is the same for all Shopee rows.
- **Dates**: `scan time` and `Upload Time` are text `YYYY-MM-DD HH:MM:SS` on all 114 rows, no time zone; every scan date is
  2026-10-10.
- **Phones** (`consignee mobile`): Shopee rows are 12 digits (`855` + 9) or 11 digits (`855` + 8); other rows also show `855-0…`,
  `+855-…` and 9-digit local forms. All Shopee phones pass `normalizePhone`.
- **Expected review for this sample** (a validation check, not a production constant), into an empty database, Arrival Batch
  Date 2026-10-10:

| Count | Value |
|---|---|
| Source rows | 114 = 89 Shopee + 25 excluded |
| Excluded codes | 14 |
| Unique parcels | 60 |
| Repeat rows collapsed | 29 |
| Database duplicates / left out / blocked | 0 / 0 / 0 |
| Ready to import | 60, each with arrival date 2026-10-10 and its 1 or 2 scan events |
| Scan dates | one, 2026-10-10; on any other day the scan-date warning appears and the date must be chosen |

## Test fixtures

`test/fixtures/` holds synthetic files only (fake names, phones and codes; real outlet names), with the 26 real headers in order.
Regenerate with `python3 test/fixtures/make-scan-record.py`; the script asserts the `scan-record-mixed` counts below.

| File | Format and purpose |
|---|---|
| `scan-record-mixed.csv` | CSV, UTF-8 |
| `scan-record-mixed.xlsx` | XLSX, text cells as in the real export |
| `scan-record-mixed-xlsx-named.xls` | the same XLSX with an `.xls` name, like the real export |
| `scan-record-mixed-biff.xls` | legacy Excel 97 `.xls` (LibreOffice), same content |
| `scan-record-two-days.csv/.xlsx` | 5 Shopee rows, 4 parcels; `10000000000003` scanned on 2026-10-09, the rest on 2026-10-10 |
| `headers-no-send-outlet.csv/.xlsx` | `Send Outlet` removed → check fails, nothing imported |
| `headers-two-send-outlet.csv/.xlsx` | `Send Outlet` twice → check fails, nothing imported |
| `headers-no-scan-order-number.csv/.xlsx` | tracking column removed → check fails, nothing imported |
| `headers-case-and-spaces.csv/.xlsx` | header written ` SEND OUTLET ` → accepted; same result as `scan-record-mixed` |

All `scan-record-mixed` formats and every `.xlsx` were read back and compared cell by cell with their CSV (the legacy `.xls` via a
LibreOffice CSV round trip): identical, including leading zeros, letter case, NBSP and inner spaces.

Expected review for `scan-record-mixed` (every format, empty database, all scan dates 2026-10-10, nothing left out):

| Count | Value | Rows / codes |
|---|---|---|
| Source rows | 28 | 18 Shopee + 10 excluded |
| Shopee SHPE rows | 18 | exact, ` shopee shpe `, `SHOPEE SHPE`, NBSP-padded |
| Excluded rows | 10 | 3 real other outlets, 2 blank-outlet split rows (`X000000001`, `X000000002`), `Shopee`, `Shopee SHPE Extra`, `Shopee  SHPE`, `Other Outlet`, a Taobao row reusing Shopee code `10000000000002` |
| Excluded codes | 10 | includes `10000000000002`, which is also a Shopee parcel and stays one |
| Unique parcels | 10 | |
| Repeat rows collapsed | 8 | `10000000000005` three rows; `…001`, `…014`, `…015`, `…016`, `00000000000017`, `S000000018` two each |
| Database duplicates skipped | 0 | |
| Left out | 0 | |
| Blocked | 3 | `10000000000014` phone differs; `10000000000015` name differs; `S000000018` also written `s000000018` |
| Not blocked | — | `10000000000016`: name ` test customer q ` vs `Test Customer Q`, phone `855-0123456716` vs `855123456716` |
| Ready to import | 7 | includes `00000000000017` (leading zeros kept); 10 once staff resolve all three |

Every new parcel gets the selected Arrival Batch Date, whatever its rows' scan types or times.

Expected review for `scan-record-two-days`: 5 source rows, all Shopee; 4 unique parcels; 1 repeat row collapsed; scan dates
2026-10-10 (3 parcels) and 2026-10-09 (1 parcel). Confirm refused until a choice is made. "All on the batch date" → 4 ready;
"only 2026-10-10" → 3 ready, 1 left out. Re-checking the same file afterwards is allowed only for 2026-10-09, and the review
shows 2026-10-10 as already imported (3 parcels).

## Tests (Phase 4)

- Every `scan-record-mixed` format gives the table above. Format is detected from content: the `.xls`-named XLSX and the
  legacy `.xls` both read.
- Counts: for every fixture, source rows = Shopee + excluded rows, and unique parcels = database duplicates + left out + blocked
  + ready.
- Outlet filter: capitals, surrounding spaces and NBSP included; near misses, blanks and other outlets excluded and counted.
- Repeat events collapse into one parcel; differing scan type, time, site and upload time are not conflicts; every row's scan
  type, scan time (source text and parsed UTC), site and upload time is stored as that parcel's scan events.
- Conflicting name or phone: blocked and itemised, confirm refused until resolved or left out; no row picked automatically.
  Name differences in case or spacing only are not conflicts.
- Tracking codes: stored exactly as trimmed (leading zeros, internal spaces, letter case kept); grouping, database duplicates and
  lookups use the upper-cased key; `S000000018`/`s000000018` form one blocked parcel until staff pick the spelling; a file code
  matching a stored code only by case is skipped as a database duplicate and marked, and the stored spelling is unchanged.
- Scan times: `2026-10-10 07:15:00` is stored as that text and as `2026-10-10T00:15:00Z`; an unparseable value keeps its text,
  gets no scan date and is listed.
- Arrival Batch Date: defaults to today in `Asia/Phnom_Penh` (test with a clock at 23:30 UTC, when it is already the next day in
  Phnom Penh); with scan date ≠ today, the warning shows and confirm is refused until the operator chooses a date; the scan date is
  never applied on its own; an operator-chosen date lands on every new parcel; `Upload Time`, import time and scan types never
  change it.
- Scan types: a file with only `Delivery` rows, only `arrived` rows, or both gives the same parcels and the same arrival date.
- `scan-record-two-days`: as described above, including the re-review that offers only 2026-10-09 and skips the 3 parcels
  already created. Uploading `scan-record-mixed` a second time (all dates imported) still gets the duplicate-file warning or block.
- Header fixtures: missing or duplicated `Send Outlet`, missing tracking column → check fails, nothing written; case/space
  variant accepted.
- File with no Shopee rows: none found, confirm refused, `no_eligible_rows`, zero parcels.
- Database: a parcel already stored is skipped and listed; the stored parcel's code spelling, name, phone (including a
  staff-edited phone), arrival date, SMS history, contact history and scan events are unchanged afterwards. A non-Shopee row with
  a stored parcel's code never touches it.
- Watched folder: a dropped file appears for review and creates no parcels until a staff member confirms; same review and history
  as the same file uploaded.
- Phase 4 gate: a mixed-outlet sample imports only its Shopee rows before any real export is imported; the real sample's review
  matches the expected counts above.

## Decisions

| # | Question | Decision (2026-10-12) | Status |
|---|---|---|---|
| 1 | Scan types | Text-only metadata; no status or arrival date inferred | Resolved |
| 2 | Batch date when scan date ≠ today | Default today (Phnom Penh); warning; operator must choose explicitly; scan date never substituted | Resolved |
| 3 | Same file, partly imported | Controlled re-review of the remaining scan dates, showing what was already imported; ordinary repeats keep duplicate-file protection | Resolved |
| 4 | Time zone of scan times | Asia/Phnom_Penh; source text kept; assumption recorded per import | Resolved |
| 5 | Name comparison | Case-insensitive, whitespace-normalised; such differences are not conflicts | Resolved |
| 6 | Tracking code case | Stored as trimmed; upper-cased key for matching; case-only variants never two parcels; ambiguous spellings blocked for staff | Resolved |
| — | Meaning of `Delivery`, `arrived`, `Whole package to piece scanning` | Not needed for V1 under decision 1 | Open (business) |
