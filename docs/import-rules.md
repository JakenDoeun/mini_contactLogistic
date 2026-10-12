# Import rules: company "Today" scan export, Shopee only

Required for every import (plan Revision 3, Phase 4). Implemented in Phase 4; this is the specification its tests check.
Revision 2026-10-12c: arrival batch date chosen in the review; scan types are not interpreted.

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
| Tracking code | `scan order number` (decided 2026-10-12) | yes | yes | parcel identifier, stored as text |
| Recipient name | `consignee name` | yes | yes | parcel record |
| Phone | `consignee mobile` | yes | yes | parcel record |
| Event timestamp | `scan time` | yes | yes | scan-event metadata; multi-day check |
| Scan event type | `scanTypeDesc` | yes | no | scan-event metadata only, never interpreted |
| Upload timestamp | `Upload Time` | yes | no | scan-event metadata only |
| Outlet filter | `Send Outlet` = `Shopee SHPE` | **no, fixed** | yes | filter |

- Header matching for every field: trimmed, case-insensitive, exact. A required header that is missing, or any mapped header
  found more than once → the check fails, naming the column, and nothing is imported. A missing optional header → the review
  notes it; those metadata fields stay empty.
- All cells are read as text. The tracking code is kept exactly as written (letters, leading zeros); it is never converted to a
  number. Only surrounding whitespace is trimmed.
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

## Rule `arrival-batch-date/v1`

1. The review has an explicit **Arrival Batch Date**, defaulting to today's date in `Asia/Phnom_Penh` (the company's "Today"
   batch). The operator can pick another date when importing an earlier batch late.
2. Every new parcel from the confirmed import gets that date as its arrival date. The import record stores it, and whether the
   operator changed it from the default.
3. Never the arrival date: `Upload Time`, the time the file is imported, or anything inferred from `scanTypeDesc`.
4. **Several scan dates**: if the Shopee rows' `scan time` dates (`YYYY-MM-DD`, read as branch local time) are not all the same,
   the review shows parcels per scan date and requires a choice before Confirm: either "all of these parcels arrived on
   <Arrival Batch Date>" (explicit tick), or "import only parcels scanned on <date>" (the rest are left out and counted). Nothing
   is silently assigned. A parcel whose own rows span two dates counts under its earliest scan date. If `scan time` is unreadable
   on some rows, the review says so and requires the same choice.

## Rule `scan-events-to-parcels/v1`

1. **Group** the Shopee rows by tracking code. One group = one parcel candidate. Repeat rows of a code are collapsed, not
   counted as in-file duplicates.
2. **Not conflicts**: differences in scan type, scan time, scan site, upload time or any other column.
3. **Conflict**: within a group, recipient name (trimmed, inner spaces collapsed, case-insensitive) or phone (after
   `normalizePhone`) differs. The code is flagged for staff review; no row is picked automatically. Staff choose the name and
   phone from the values shown, or leave the parcel out of this import.
4. **Scan types are not interpreted**: `Delivery`, `arrived` and `Whole package to piece scanning` are stored as text. Their
   meanings are unconfirmed, so no parcel status (delivered, received, collected, …) is derived from them.
5. **Metadata kept**: for every Shopee row of a new parcel, its scan type, scan time, scan site and upload time are stored as
   that parcel's source scan events, separate from the arrival date.
6. **Existing records**: a code already in the database is reported as "already imported" and skipped. Nothing in an existing
   parcel is changed: not its name, phone (including staff-edited phones), arrival date, notification (SMS) history or contact
   history, and no scan events are added to it. If the file's name or phone differs from the stored one, the review lists it for
   information only.

## Order of the import check

1. Whole-file SHA-256 against earlier imports (unchanged; warn or block per Settings).
2. Format from the file's bytes, not its name: XLSX (zip), legacy Excel 97 `.xls` (OLE), or CSV. The company export is XLSX
   saved as `.xls`.
3. Headers: every required mapped column present once; `Send Outlet` present once.
4. Outlet filter.
5. Group Shopee rows into parcel candidates; find conflicts; check scan dates.
6. Candidate codes already in the database.
7. Review: Arrival Batch Date, staff resolve flags, explicit Confirm. Confirm writes new parcels and their scan events in one
   transaction.

## Review, confirmation and history

The review shows, and the confirmed import (or a check with no eligible rows) saves:

- Arrival Batch Date (and whether it was changed from today);
- total source rows; Shopee SHPE rows; rows excluded as not Shopee;
- unique parcel candidates; repeat scan rows collapsed (Shopee rows minus candidates);
- already in the database, itemised; recipient conflicts, itemised (code, the differing names/phones with their scan rows);
- scan dates found, with parcels per date;
- final number of new parcel records;
- rule IDs (`send-outlet-shopee-shpe/v1`, `arrival-batch-date/v1`, `scan-events-to-parcels/v1`) and the headers as found.

Confirm is an explicit staff action. It is refused while a conflict is unresolved or a several-scan-dates choice is missing.
Files found in the watched folder are only checked and queued for review; they are never imported without that confirmation.
No eligible rows: the review says so, Import is disabled, the confirm endpoint refuses, history status `no_eligible_rows`, zero
parcels created. Counts are computed from each file; nothing expects fixed numbers.

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
- **Tracking codes**: 14 digits, or a letter plus 9 digits on the 2 split rows. No leading zeros or surrounding spaces in this
  sample. The 2 split rows have distinct codes, appear nowhere else, and have no outlet, name or phone (so they are excluded).
  No code appears on both a Shopee and an excluded row.
- **Repeat events**: the 89 Shopee rows hold 60 parcels: 29 with an `arrived` and a `Delivery` row, 31 with only `Delivery`.
  Name and phone identical within every parcel (0 conflicts). Scan site is the same for all Shopee rows.
- **Dates**: `scan time` and `Upload Time` are text `YYYY-MM-DD HH:MM:SS`, no time zone; every `scan time` is on 2026-10-10.
- **Phones** (`consignee mobile`): Shopee rows are 12 digits (`855` + 9) or 11 digits (`855` + 8); other rows also show `855-0…`,
  `+855-…` and 9-digit local forms. All Shopee phones pass `normalizePhone`.
- **Expected review for this sample** (a validation check, not a production constant), into an empty database with Arrival
  Batch Date 2026-10-10: 114 rows; 89 Shopee; 25 excluded; 60 parcel candidates; 29 repeat rows collapsed; 0 already in the
  database; 0 conflicts; one scan date (2026-10-10, 60 parcels); 60 new parcels, each with arrival date 2026-10-10 and its 1 or 2
  scan events.

## Test fixtures

`test/fixtures/` holds synthetic files only (fake names, phones and codes; real outlet names), with the 26 real headers in order.
Regenerate with `python3 test/fixtures/make-scan-record.py`; the script asserts the expected counts below.

| File | Format and purpose |
|---|---|
| `scan-record-mixed.csv` | CSV, UTF-8 |
| `scan-record-mixed.xlsx` | XLSX, text cells as in the real export |
| `scan-record-mixed-xlsx-named.xls` | the same XLSX with an `.xls` name, like the real export |
| `scan-record-mixed-biff.xls` | legacy Excel 97 `.xls` (LibreOffice), same content |
| `scan-record-two-days.csv/.xlsx` | 4 Shopee parcels, one scanned on 2026-10-09 → several-scan-dates choice required |
| `headers-no-send-outlet.csv/.xlsx` | `Send Outlet` removed → check fails, nothing imported |
| `headers-two-send-outlet.csv/.xlsx` | `Send Outlet` twice → check fails, nothing imported |
| `headers-no-scan-order-number.csv/.xlsx` | tracking column removed → check fails, nothing imported |
| `headers-case-and-spaces.csv/.xlsx` | header written ` SEND OUTLET ` → accepted; same result as `scan-record-mixed` |

All `scan-record-mixed` formats and every `.xlsx` were read back and compared cell by cell with their CSV (the legacy `.xls` via a
LibreOffice CSV round trip): identical, including leading zeros, NBSP and inner spaces.

Expected review for `scan-record-mixed` (every format, empty database, all scan times on 2026-10-10):

| Count | Value | Rows / codes |
|---|---|---|
| Source rows | 27 | |
| Shopee SHPE rows | 17 | exact, ` shopee shpe `, `SHOPEE SHPE`, NBSP-padded |
| Excluded | 10 | 3 real other outlets, 2 blank-outlet split rows (`X000000001`, `X000000002`), `Shopee`, `Shopee SHPE Extra`, `Shopee  SHPE`, `Other Outlet`, Taobao row reusing Shopee code `10000000000002` |
| Unique parcel candidates | 10 | |
| Repeat rows collapsed | 7 | `10000000000005` has three rows; five other codes two each |
| Already in database | 0 | |
| Recipient conflicts | 2 | `10000000000014` phone differs; `10000000000015` name differs |
| Not a conflict | — | `10000000000016`: name ` test customer q ` vs `Test Customer Q`, phone `855-0123456716` vs `855123456716` |
| New parcels | 8, or 10 after staff resolve both conflicts | includes `00000000000017` (leading zeros kept) and `S000000018` (letter code) |

Every new parcel gets the selected Arrival Batch Date, whatever its rows' scan types or times.

## Tests (Phase 4)

- Every `scan-record-mixed` format gives the table above. Format is detected from content: the `.xls`-named XLSX and the
  legacy `.xls` both read.
- Outlet filter: capitals, surrounding spaces and NBSP included; near misses, blanks and other outlets excluded and counted.
- Repeat events collapse into one parcel; differing scan type, time, site and upload time are not conflicts; every row's scan
  type, scan time, site and upload time is stored as that parcel's scan events.
- Conflicting name or phone: flagged and itemised, confirm refused until resolved or left out; no row picked automatically.
- Arrival Batch Date: defaults to today in `Asia/Phnom_Penh` (test with a clock just after 00:00 and just before 24:00 local, when
  UTC is on a different day); an operator-chosen date lands on every new parcel; `Upload Time`, import time and scan types never
  change it.
- Scan types: a file with only `Delivery` rows, only `arrived` rows, or both gives the same parcels and the same arrival date.
- `scan-record-two-days`: confirm refused until the operator ticks one date for all, or picks "only parcels scanned on
  <date>" (then the others are left out and counted).
- Tracking codes kept as text: leading zeros and letters survive into the parcel record.
- Header fixtures: missing or duplicated `Send Outlet`, missing tracking column → check fails, nothing written; case/space
  variant accepted.
- File with no Shopee rows: none found, confirm refused, `no_eligible_rows`, zero parcels.
- Database: a candidate code already stored is skipped and listed; the stored parcel's name, phone (including a staff-edited
  phone), arrival date, SMS history, contact history and scan events are unchanged afterwards. A non-Shopee row with a stored
  parcel's code never touches it.
- Watched folder: a dropped file appears for review and creates no parcels until a staff member confirms; same review and history
  as the same file uploaded.
- Phase 4 gate: a mixed-outlet sample imports only its Shopee rows before any real export is imported; the real sample's review
  matches the expected counts above.
