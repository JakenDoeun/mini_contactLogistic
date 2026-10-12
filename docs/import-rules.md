# Import rules: Shopee-only filter

Required for every import (plan Revision 3, Phase 4). Implemented in Phase 4; this is the specification its tests check.

**MUST (Phase 4):** the server filters every import to rows whose `Send Outlet` is `Shopee SHPE` (rule below). If the file has
no `Send Outlet` column, or has it twice, the import check fails and nothing is imported. There is no fallback that imports all
rows, no setting that turns the filter off, and no client-side filtering in its place.

## Rule `send-outlet-shopee-shpe/v1`

- **Column**: the header that, trimmed and compared without regard to capitals, equals `Send Outlet`.
  - No such header → the check fails: "This file has no Send Outlet column, so Shopee parcels cannot be identified. Nothing was imported."
  - More than one such header → the check fails the same way (ambiguous).
  - Never a fallback to importing all rows.
- **Row**: include only when the cell, after trimming surrounding whitespace (including non-breaking spaces) and lower-casing,
  equals `shopee shpe`. Exact comparison: no substring, prefix or fuzzy matching; inner spaces must match.
- Applied on the server, inside the one import check used by manual uploads and watched-folder files, **before** any duplicate check
  and before any parcel record can be created. The browser never decides which rows count.
- Excluded rows are only counted: they are never stored, and their tracking codes are not checked against the database.

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

## Order of the import check

1. Whole-file SHA-256 against earlier imports (unchanged; warn or block per Settings).
2. Readable as `.xlsx`, `.xls` or `.csv`.
3. Tracking-code column and `Send Outlet` column present.
4. Outlet filter.
5. On eligible rows only: codes repeated within the file, then codes already in the database.
6. Arrival date for eligible rows (unchanged).

## Review and history

Review shows, and the confirmed import (or a check with no eligible rows) saves: total source rows, Shopee SHPE rows,
rows excluded as not Shopee, codes already in the database, codes repeated within the eligible rows, new Shopee parcels to import;
plus the rule ID and the outlet header as found. No eligible rows: the review says so, Import is disabled, the confirm endpoint
refuses, history status `no_eligible_rows`, zero parcels created.

## Tests (Phase 4)

- Mixed outlets in one file, as `.xlsx`, `.xls` and `.csv`: only Shopee rows become parcels; counts right in all three.
- Capitals and surrounding spaces (including non-breaking spaces): included.
- Blank and missing cells, `Shopee`, `Shopee SHPE Extra`, `Shopee  SHPE`, `Other Outlet`: excluded and counted.
- No `Send Outlet` column; two `Send Outlet` columns: check fails, nothing written.
- File with no Shopee rows: none found, confirm refused, `no_eligible_rows`, zero parcels.
- Duplicates: Shopee code already in the database; Shopee code twice in the file; non-Shopee row sharing a code with an existing parcel
  (only counted as excluded, never touches that parcel).
- Same mixed file uploaded and found in the watched folder: identical counts; history holds counts and rule ID.
- Phase 4 gate: a mixed-outlet sample imports only its Shopee rows before any real export is imported.

## Real export: `Scan_record.xls` (checked 2026-10-12)

The company-provided export was read in place; it contains real customer names and phones, so it is **not** committed
(`*.xls` is ignored outside `test/fixtures/`). Findings:

- **Format**: XLSX content (zip, Excel 2007+) saved with an `.xls` name. The importer must detect the format from the file's
  bytes, not its extension. One sheet (`Sheet1`), header in row 1, 114 data rows.
- **Headers** (A–Z, exact): `scan order number`, `Data Source`, `scanTypeDesc`, `scan time`, `scan person`, `scan site`,
  `Up/Next Site`, `Receiver/Dispatch Member`, `Upload Time`, `Send Outlet`, `Destination Outlet`, `number of pieces`, `weight`,
  `netWeight`, `payment on arrival`, `collected payment`, `item type`, `consignee name`, `consignee mobile`, `consignee address`,
  `␠Remarks` (leading space), `signMan`, `isRefundDesc`, `problemReason`, `customerCodeDesc`, `customerCode`.
- **Send Outlet**: column J, header exactly `Send Outlet`. `Shopee SHPE` appears exactly so (no extra spaces) on 89 rows; other
  values: `Taobao ZTO PP transit warehouse` 13, `ZTO Guangzhou International Warehouse` 6, `Siem Reap Province SRP-01` 4, blank 2
  (both `Whole package to piece scanning` rows, which also have no consignee). `customerCodeDesc` carries the same value, but the
  rule uses `Send Outlet` only.
- **Cells are text** (number format 49), except the numeric columns L–P. Codes and phones must be read as text.
- **Dates**: no column is named "arrival date". `scan time` and `Upload Time` are both text `YYYY-MM-DD HH:MM:SS`. Proposed
  arrival date: the date part of `scan time` (to confirm).
- **Tracking code**: `scan order number` (to confirm): 14 digits, or a letter plus 9 digits on split rows.
- **Repeated scan rows**: the same parcel appears once per scan. The 89 Shopee rows hold 60 parcels: 29 have an `arrived` and a
  `Delivery` row, 31 only `Delivery`; name and phone are identical across a parcel's rows. Counting these as "repeated within the
  file" would flag half the parcels, so Phase 4 needs a decision (proposed: one parcel per code, repeat scans of the same code with
  the same consignee are not errors; differing consignee → error).
- **Phones** (`consignee mobile`): Shopee rows are 12 digits (`855` + 9) or 11 digits (`855` + 8); other rows also show
  `855-0…`, `+855-…` and 9-digit local forms. All Shopee phones pass the existing `normalizePhone` rule.
- Settings defaults `trackingColumn: 'Tracking code'` and `phoneColumn: 'Phone'` do not match this export; Phase 4 changes them.

## Test fixtures

`test/fixtures/scan-record-mixed.*` are synthetic (fake names, phones, codes; real outlet names only), with the 26 real headers
in order. Regenerate with `python3 test/fixtures/make-scan-record.py`.

| File | Format |
|---|---|
| `scan-record-mixed.csv` | CSV, UTF-8 |
| `scan-record-mixed.xlsx` | XLSX, text cells as in the real export |
| `scan-record-mixed-xlsx-named.xls` | the same XLSX with an `.xls` name, like the real export |
| `scan-record-mixed-biff.xls` | legacy Excel 97 `.xls` (LibreOffice), same content |

Expected for every format: 15 rows; 6 `Shopee SHPE` (exact, ` shopee shpe `, `SHOPEE SHPE`, NBSP-padded, and one code with an
`arrived` and a `Delivery` row); 9 excluded (three real other outlets, blank outlet on a split row, `Shopee`, `Shopee SHPE Extra`,
`Shopee  SHPE`, `Other Outlet`, and a Taobao row reusing Shopee code `10000000000002`); 5 distinct Shopee codes.
