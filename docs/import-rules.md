# Import rules: Shopee-only filter

Required for every import (plan Revision 3, Phase 4). Implemented in Phase 4; this is the specification its tests check.

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

## To confirm with a real export

Before Phase 4, one de-identified sample export (a few rows, names and phones replaced) would confirm the exact `Send Outlet`
header text, how `Shopee SHPE` appears in it, and the arrival-date column. Sample files go in `test/fixtures/` only when synthetic.
