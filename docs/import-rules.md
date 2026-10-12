# Import rules: company scan export, Shopee only

Required for every import (plan Revision 3, Phase 4). Implemented in Phase 4; this is the specification its tests check.
Revision 2026-10-12b: field mapping, arrival date, repeated scan events, conflicts.

**MUST (Phase 4):** the server filters every import to rows whose `Send Outlet` is `Shopee SHPE` (rule below). If the file has
no `Send Outlet` column, or has it twice, the import check fails and nothing is imported. There is no fallback that imports all
rows, no setting that turns the filter off or changes its column or value, and no client-side filtering in its place.

## Field mapping (company `Scan_record` export)

| Field | Source header (default) | Configurable in Settings | Required |
|---|---|---|---|
| Tracking code | `scan order number` (decided 2026-10-12) | yes | yes |
| Recipient name | `consignee name` | yes | yes |
| Phone | `consignee mobile` | yes | yes |
| Scan event type | `scanTypeDesc` | yes | yes |
| Event timestamp | `scan time` | yes | yes |
| Upload timestamp | `Upload Time` | yes | no (stored for history only; never the arrival date) |
| Arrival event value | `arrived` | yes | — |
| Outlet filter | `Send Outlet` = `Shopee SHPE` | **no, fixed** | yes |

- Header matching for every field: trimmed, case-insensitive, exact. A required header that is missing, or any mapped header
  found more than once → the check fails, naming the column, and nothing is imported.
- Event values match trimmed and case-insensitive: the export writes `arrived`; `Arrived` or `arrived ` also count.
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
- Applied on the server, inside the one import check used by manual uploads and watched-folder files, **before** grouping,
  duplicate checks and before any parcel record can be created. The browser never decides which rows count.
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

## Rule `scan-events-to-parcels/v1`

The export has one row per scan event, not per parcel.

1. **Group** the Shopee rows by tracking code. One group = one parcel candidate. Repeat rows of a code are collapsed, not
   counted as in-file duplicates.
2. **Not conflicts**: differences in scan type, scan time, scan site, upload time or any other column.
3. **Conflict**: within a group, recipient name (trimmed, inner spaces collapsed, case-insensitive) or phone (after
   `normalizePhone`) differs. The code is flagged for manual review; no row is picked automatically. Staff choose the name and
   phone from the values shown, or leave the parcel out of this import.
4. **Arrival date**: the earliest `scan time` among the group's arrival events (`arrived`). `Upload Time` is never used.
   A group with no arrival event is flagged "arrival date missing"; staff enter its arrival date, or leave it out of this import.
5. **Confirm** is refused while any included parcel is still flagged. Staff resolutions (who, when, chosen values) are saved with
   the import.
6. **Existing records**: a code already in the database is reported as "already imported" and skipped. Nothing in an existing
   parcel is changed: not its name, phone (including staff-edited phones), arrival date, or SMS state. If the file's name or
   phone differs from the stored one, the review lists it for information only.

## Order of the import check

1. Whole-file SHA-256 against earlier imports (unchanged; warn or block per Settings).
2. Format from the file's bytes, not its name: XLSX (zip), legacy Excel 97 `.xls` (OLE), or CSV. The company export is XLSX
   saved as `.xls`.
3. Headers: every required mapped column present once; `Send Outlet` present once.
4. Outlet filter.
5. Group Shopee rows into parcel candidates; find conflicts; pick arrival dates; flag missing arrival.
6. Candidate codes already in the database.
7. Review; staff resolve flags; confirm writes new parcels in one transaction.

## Review and history

The review shows, and the confirmed import (or a check with no eligible rows) saves:

- total source rows; Shopee SHPE rows; rows excluded as not Shopee;
- parcel candidates; repeat scan rows collapsed (Shopee rows minus candidates);
- conflicts, itemised (code, the differing names/phones and their scan types and times);
- missing arrival date, itemised (code, recipient, scan types and times found);
- already in the database, itemised; new parcels to import;
- rule IDs (`send-outlet-shopee-shpe/v1`, `scan-events-to-parcels/v1`) and the headers as found.

No eligible rows: the review says so, Import is disabled, the confirm endpoint refuses, history status `no_eligible_rows`,
zero parcels created. Counts are computed from each file; nothing expects fixed numbers.

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
  `arrived` 29.
- **Tracking codes**: 14 digits, or a letter plus 9 digits on the 2 split rows. No leading zeros or surrounding spaces in this
  sample. The 2 split rows have distinct codes, appear nowhere else, and have no outlet, name or phone (so they are excluded).
  No code appears on both a Shopee and an excluded row.
- **Repeat events**: the 89 Shopee rows hold 60 parcels: 29 with one `arrived` and one `Delivery` row, 31 with only `Delivery`.
  Same code for both events of a parcel; name and phone identical within every parcel (0 conflicts). Every `Delivery` scan is at or
  after its parcel's `arrived` scan. Scan site is the same for all Shopee rows.
- **Dates**: `scan time` and `Upload Time` are text `YYYY-MM-DD HH:MM:SS`, no time zone; all 2026-10-10 in this sample.
- **Phones** (`consignee mobile`): Shopee rows are 12 digits (`855` + 9) or 11 digits (`855` + 8); other rows also show `855-0…`,
  `+855-…` and 9-digit local forms. All Shopee phones pass `normalizePhone`.
- **Expected review for this sample** (a validation check, not a production constant): 114 rows; 89 Shopee; 25 excluded;
  60 parcel candidates; 29 repeat rows collapsed; 0 conflicts; **31 missing arrival date** (the `Delivery`-only parcels);
  29 ready with arrival date 2026-10-10.

## Test fixtures

`test/fixtures/` holds synthetic files only (fake names, phones and codes; real outlet names), with the 26 real headers in order.
Regenerate with `python3 test/fixtures/make-scan-record.py`; the script asserts the expected counts below.

| File | Format |
|---|---|
| `scan-record-mixed.csv` | CSV, UTF-8 |
| `scan-record-mixed.xlsx` | XLSX, text cells as in the real export |
| `scan-record-mixed-xlsx-named.xls` | the same XLSX with an `.xls` name, like the real export |
| `scan-record-mixed-biff.xls` | legacy Excel 97 `.xls` (LibreOffice), same content |
| `headers-no-send-outlet.csv/.xlsx` | `Send Outlet` removed → check fails, nothing imported |
| `headers-two-send-outlet.csv/.xlsx` | `Send Outlet` twice → check fails, nothing imported |
| `headers-no-scan-type.csv/.xlsx` | `scanTypeDesc` removed → check fails, nothing imported |
| `headers-case-and-spaces.csv/.xlsx` | header written ` SEND OUTLET ` → accepted; same result as `scan-record-mixed` |

All four `scan-record-mixed` formats were read back and compared cell by cell with the CSV (the `.xls` via a LibreOffice CSV
round trip): identical, including leading zeros, NBSP and inner spaces.

Expected review for `scan-record-mixed` (every format):

| Count | Value | Rows / codes |
|---|---|---|
| Source rows | 27 | |
| Shopee SHPE rows | 17 | exact, ` shopee shpe `, `SHOPEE SHPE`, NBSP-padded |
| Excluded | 10 | 3 real other outlets, 2 blank-outlet split rows (`X000000001`, `X000000002`), `Shopee`, `Shopee SHPE Extra`, `Shopee  SHPE`, `Other Outlet`, Taobao row reusing Shopee code `10000000000002` |
| Parcel candidates | 10 | |
| Repeat rows collapsed | 7 | |
| Conflicts | 2 | `10000000000014` phone differs; `10000000000015` name differs |
| Not a conflict | — | `10000000000016`: name ` test customer q ` vs `Test Customer Q`, phone `855-0123456716` vs `855123456716` |
| Missing arrival date | 3 | `10000000000002`, `10000000000003`, `10000000000004` |
| Ready | 5 | `10000000000001` arrival 2026-10-10 07:15:00; `10000000000005` arrival **2026-10-09 23:50:00** (earliest of two `arrived`, earlier day than its other scans); `10000000000016`; `00000000000017` (leading zeros kept, event written `Arrived `); `S000000018` (letter code, `arrived` only) |

## Tests (Phase 4)

- Every `scan-record-mixed` format gives the table above. Format is detected from content: the `.xls`-named XLSX and the
  legacy `.xls` both read.
- Outlet filter: capitals, surrounding spaces and NBSP included; near misses, blanks and other outlets excluded and counted.
- Repeat events collapse into one parcel; differing scan type, time, site and upload time are not conflicts.
- Conflicting name or phone: flagged and itemised, confirm refused until resolved or left out; no row picked automatically.
- Arrival date: earliest `arrived` scan time, never `Upload Time`; missing arrival flagged, confirm refused until resolved or
  left out.
- Tracking codes kept as text: leading zeros and letters survive into the parcel record.
- Header fixtures: missing or duplicated `Send Outlet`, missing `scanTypeDesc` → check fails, nothing written; case/space
  variant accepted.
- File with no Shopee rows: none found, confirm refused, `no_eligible_rows`, zero parcels.
- Database: a candidate code already stored is skipped and listed; the stored parcel's name, phone (including a staff-edited
  phone), arrival date and SMS state are unchanged afterwards. A non-Shopee row with a stored parcel's code never touches it.
- Same file uploaded and found in the watched folder: identical review and history.
- Phase 4 gate: a mixed-outlet sample imports only its Shopee rows before any real export is imported; the real sample's review
  matches the expected counts above.
