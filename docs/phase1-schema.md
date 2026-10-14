# Phase 1 schema and migration design

Status: **design approved 2026-10-12 (decisions 31–37). Implemented ahead of Phase 0 (sequencing exception) and
committed as `cd62115`. Formal review 2026-10-14: accepted by the owner with documented conditions, not as defect-free
(see "Review 2026-10-14" at the end). The corrective commits (branch `phase1-review-fixes`) were merged into `main` on
2026-10-14 with the owner's approval, after Phase 0.** The open findings keep their phase gates. No deployment, real customer data or production import is authorised.

Sources: backend plan Revision 3 ("Database schema", "Imports", "Phase 1: Foundation"), `docs/import-rules.md`
(revision 2026-10-12d), Phase 1 readiness review (2026-10-12).

## Conventions

- SQLite through `better-sqlite3` 13.0.3 and Drizzle ORM 0.45.4 (Drizzle Kit 0.31.11 for generating migrations, development
  only). Exact pins, added in Phase 1 after Phase 0.
- Connection: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`.
- `id INTEGER PRIMARY KEY` unless stated. Foreign keys `ON DELETE RESTRICT` everywhere: history is never deleted by cascade.
- Timestamps: UTC ISO text `YYYY-MM-DDTHH:MM:SS.sssZ` (`*_at`, `*_utc`). Local dates: text `YYYY-MM-DD` (Asia/Phnom_Penh),
  with `CHECK (x GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')`.
- Booleans: `INTEGER NOT NULL CHECK (x IN (0,1))`. Closed value sets: `TEXT` + `CHECK (x IN (...))`. JSON: `TEXT` +
  `CHECK (json_valid(x))`.
- `*_raw` columns hold the source text exactly as read (after nothing but cell-to-text conversion).
- `*_by` columns reference `users(id)`; NULL means the system (worker, seed, start-up script).
- Append-only tables (`parcel_phone_changes`, `parcel_scan_events`, `import_review_items` (never deleted; a decision may be
  revised while its import is `checked` and is frozen once it is not, decision 38), `notifications`,
  `notification_parcels`, `contact_attempts`, `contact_attempt_parcels`, `audit_log`, `backup_runs`): no DELETE; triggers
  `BEFORE DELETE … RAISE(ABORT)` on all of them, and `BEFORE UPDATE … RAISE(ABORT)` on `parcel_phone_changes`,
  `parcel_scan_events` and `audit_log`.

## Tables (18)

Drizzle's migration-tracking table `__drizzle_migrations` is managed by the migration runner and not counted. The count is 18
in this file, in the backend plan's schema table and in its decisions table.

### Parcels and imports

**1. `parcels`**: one row per physical parcel.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `tracking_code` | TEXT NOT NULL | the source code with surrounding whitespace (incl. NBSP) trimmed; shown to staff; case, internal spaces, leading zeros kept |
| `tracking_key` | TEXT NOT NULL UNIQUE | `tracking_code` with ASCII letters `a–z` upper-cased and nothing else changed |
| `recipient_name` | TEXT NOT NULL | as imported (or as chosen by staff in a conflict) |
| `import_phone_raw` | TEXT | phone as imported; written once at insert, never changed |
| `phone_raw` | TEXT | current phone; changed only by a staff edit |
| `phone_normalized` | TEXT | `normalizePhone(phone_raw)` when valid, else NULL |
| `phone_edited` | INTEGER 0/1 NOT NULL DEFAULT 0 | 1 after the first staff edit; never reset |
| `arrival_date` | TEXT NOT NULL, local date | the import's Arrival Batch Date |
| `first_import_id` | INTEGER NOT NULL → `imports` | the import that created it |
| `created_at`, `updated_at` | TEXT NOT NULL | |

Constraints: `CHECK (length(tracking_code) > 0)`; `CHECK (tracking_key = upper(tracking_code))` (SQLite's built-in `upper()`
changes only ASCII letters, which matches the key rule); `CHECK (phone_edited = 1 OR phone_raw IS import_phone_raw)`.
Indexes: UNIQUE `tracking_key`; (`arrival_date`, `phone_normalized`); `phone_normalized`; `recipient_name`.
No status column: SMS and contact status are derived from the append-only tables below.

**Tracking key** (rule `tracking-code-key/v1`): case-insensitive only. Internal spaces, leading zeros, punctuation and
non-ASCII characters are kept exactly. The application computes the key the same way (ASCII-only upper-casing, not
`toUpperCase()`, which changes some non-ASCII letters and lengths). Examples: `S000000018` and `s000000018` → `S000000018`;
`00000000000017` → `00000000000017`; `AB 12` → `AB 12` (not `AB12`).

**Phones**: imports insert new parcels only. A re-import, re-review or confirm never updates `phone_raw`,
`phone_normalized`, `phone_edited`, `import_phone_raw` or any `parcel_phone_changes` row of an existing parcel. A staff edit
updates `phone_raw`, `phone_normalized`, `phone_edited = 1`, `updated_at` and appends one `parcel_phone_changes` row, in one
transaction.

**2. `imports`**: one row per checked file, imported or not.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `source` | TEXT CHECK in (`manual`, `folder`, `seed`) | `seed` only for demo data |
| `detected_file_id` | INTEGER → `detected_files`, NULL | folder imports |
| `original_filename`, `stored_path` | TEXT NOT NULL | stored copy under the data folder |
| `sha256` | TEXT NOT NULL | whole-file hash |
| `size_bytes` | INTEGER NOT NULL | |
| `file_format` | TEXT CHECK in (`xlsx`, `xls`, `csv`), NULL if unreadable | detected from content |
| `status` | TEXT CHECK in (`checked`, `imported`, `no_eligible_rows`, `failed`, `cancelled`) | see "Import status" |
| `rerun_of_import_id` | INTEGER → `imports`, NULL | set on a re-review of a partly imported file |
| `rules` | TEXT JSON NOT NULL | rule IDs used, e.g. `send-outlet-shopee-shpe/v1`, `tracking-code-key/v1`, `scan-time-local/v1`, `arrival-batch-date/v1`, `scan-events-to-parcels/v1` |
| `headers_found` | TEXT JSON NOT NULL | mapped field → header as found (incl. the `Send Outlet` column) |
| `time_zone_assumed` | TEXT NOT NULL DEFAULT `Asia/Phnom_Penh` | |
| `scan_dates` | TEXT JSON NOT NULL | parcels per earliest valid scan date, plus a count of parcels with no valid scan time |
| `date_choice` | TEXT CHECK in (`single_scan_date`, `all_on_batch_date`, `only_scan_date`), NULL until confirm | |
| `chosen_scan_date` | TEXT local date, NULL | set when `date_choice = only_scan_date` |
| `arrival_batch_date` | TEXT local date, NULL until confirm | |
| `arrival_date_changed` | INTEGER 0/1 NOT NULL DEFAULT 0 | operator changed it from today |
| `rows_total`, `rows_shopee`, `rows_excluded` | INTEGER NOT NULL | rows; `rows_total = rows_shopee + rows_excluded` |
| `excluded_codes` | INTEGER NOT NULL | distinct keys on excluded rows |
| `rows_collapsed` | INTEGER NOT NULL | `rows_shopee - parcels_unique` |
| `parcels_unique` | INTEGER NOT NULL | |
| `db_duplicates`, `left_out`, `blocked`, `ready` | INTEGER NOT NULL | parcels; sum = `parcels_unique`; as at confirm (or at check if never confirmed) |
| `parcels_added` | INTEGER NOT NULL DEFAULT 0 | parcels inserted; non-zero only when `status = imported` |
| `error_code`, `error_detail` | TEXT, NULL | why a check or a confirm failed |
| `checked_at`, `checked_by` | TEXT NOT NULL, → users | |
| `confirmed_at`, `confirmed_by` | TEXT, → users, NULL | set only by a successful Confirm |

Indexes: `sha256`; `status`; `rerun_of_import_id`. CHECK constraints tie the count identities above together and the status
rules below.

**Import status** (the status `reviewed` from Revision 3 is renamed `checked`):

| Status | Meaning | Parcels inserted | Rules (CHECK) |
|---|---|---|---|
| `checked` | File read and validated; review items written; waiting for staff review and Confirm. **No parcels inserted.** | none | `confirmed_at IS NULL`, `parcels_added = 0` |
| `imported` | Confirm succeeded: parcels, scan events, counts and audit entry committed in one transaction | `parcels_added` (may be 0 if every parcel was a duplicate or left out) | `confirmed_at IS NOT NULL`, `arrival_batch_date IS NOT NULL`, `parcels_added = ready` |
| `no_eligible_rows` | Validated, but no Shopee SHPE rows; Confirm refused | none | `confirmed_at IS NULL`, `parcels_added = 0` |
| `failed` | The check failed (unreadable file, missing or duplicated header) or the Confirm transaction failed and was rolled back | none | `confirmed_at IS NULL`, `parcels_added = 0`, `error_code IS NOT NULL` |
| `cancelled` | Staff cancelled the review | none | `confirmed_at IS NULL`, `parcels_added = 0` |

Allowed changes: `checked` → `imported` | `failed` | `cancelled`; every other status is final. The change to `imported`
happens inside the Confirm transaction, so a second Confirm of the same check finds nothing to do. Only `imported` rows count
as earlier imports for the duplicate-file rule and for the scan dates already imported; a `failed` or `cancelled` file can be
checked again as a new row.

**3. `import_review_items`**: everything about one parcel candidate in one import that staff must see or decide. See
"Review items" below.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `import_id` | INTEGER NOT NULL → `imports` | |
| `tracking_key` | TEXT NOT NULL | the parcel candidate's key |
| `kind` | TEXT CHECK in (`recipient_conflict`, `code_spelling`, `db_duplicate`, `not_chosen_scan_date`, `excluded_by_staff`, `unparseable_scan_time`) | |
| `blocking` | INTEGER 0/1 NOT NULL | 1 for `recipient_conflict`, `code_spelling` |
| `detail` | TEXT JSON NOT NULL | the evidence: differing names/phones/spellings with their source rows; scan date; the unreadable time text |
| `parcel_scan_date` | TEXT local date, NULL | the candidate's earliest valid scan date |
| `existing_parcel_id` | INTEGER → `parcels`, NULL | for `db_duplicate` (incl. matches by key only) |
| `resolution` | TEXT CHECK in (`chosen`, `left_out`), NULL | NULL = open (blocking) or informational |
| `chosen` | TEXT JSON, NULL | `{ "tracking_code": "S000000018" }` or `{ "recipient_name": …, "phone_raw": … }` |
| `resolved_by`, `resolved_at` | → users, TEXT, NULL | |
| `created_at` | TEXT NOT NULL | |

Constraints: UNIQUE (`import_id`, `tracking_key`, `kind`); CHECK `resolution IS NULL OR resolved_at IS NOT NULL`;
CHECK `chosen IS NOT NULL` when `resolution = 'chosen'`. Indexes: (`import_id`, `blocking`, `resolution`); `tracking_key`.
Items can be resolved only while their import is `checked`; after that they are read-only (trigger).

**4. `parcel_scan_events`**: source scan rows of each new parcel.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `parcel_id` | INTEGER NOT NULL → `parcels` | |
| `import_id` | INTEGER NOT NULL → `imports` | |
| `source_row` | INTEGER NOT NULL | 1-based data row in the file |
| `tracking_code_raw` | TEXT NOT NULL | as written on this row (keeps case variants) |
| `scan_type_raw` | TEXT, NULL | `scanTypeDesc`; never interpreted |
| `scan_time_raw` | TEXT, NULL | `scan time` cell text, exactly as read, valid or not |
| `scan_time_utc` | TEXT, NULL | parsed time; **NULL when the text is not a valid time** |
| `scan_date` | TEXT local date, NULL | date part of a valid `scan_time_raw`; NULL when `scan_time_utc` is NULL |
| `scan_site_raw` | TEXT, NULL | |
| `upload_time_raw` | TEXT, NULL | `Upload Time` text; never parsed into an event time, never the arrival date |
| `created_at` | TEXT NOT NULL | |

Constraints: UNIQUE (`import_id`, `source_row`); `CHECK ((scan_time_utc IS NULL) = (scan_date IS NULL))`;
`CHECK (scan_time_utc IS NULL OR scan_time_raw IS NOT NULL)`. Index `parcel_id`. Written only for parcels created by that
import; never updated or deleted.

**Unreadable scan times** (rule `scan-time-local/v1`): a value is valid only if it is text of the exact form
`YYYY-MM-DD HH:MM:SS` that names a real calendar date and time (checked by converting it back: `2026-02-30 10:00:00` and
`2026-10-10 25:00:00` are invalid). Anything else (empty, other formats such as `10/10/2026 07:00`, a numeric spreadsheet date
serial, extra text) is unreadable: `scan_time_raw` keeps the original text, `scan_time_utc` and `scan_date` stay NULL, the
review lists it (`unparseable_scan_time` item), and it is never used as an event time, for ordering, for the earliest scan
date or for the scan-date-differs-from-today check. A parcel with no valid scan time has no scan date and is listed under
"no valid scan time" in the review, which requires the explicit date choice.

**5. `detected_files`**: files the watcher found, waiting for review. `path`, `size_bytes`, `modified_at`, `sha256`, `state`
CHECK in (`waiting`, `unreadable`, `imported`, `dismissed`), `first_seen_at`, `import_id` → imports NULL. UNIQUE (`path`,
`size_bytes`, `modified_at`); index `sha256`. A detected file is never imported without a staff Confirm.

**6. `parcel_phone_changes`**: the append-only record of every staff phone edit. `parcel_id` → parcels, `old_raw`,
`new_raw`, `old_normalized`, `new_normalized`, `changed_by` → users, `changed_at`. Index `parcel_id`. No UPDATE or DELETE
(triggers). Imports never write here.

### Notifications and contact

**7. `send_batches`**: one "Notify today's customers" run. `request_key` UNIQUE, `arrival_date`, `planned_messages`,
`planned_parcels`, `status` CHECK in (`running`, `paused`, `stopped`, `done`), `created_by`, `created_at`.

**8. `notifications`**: one logical message to one phone about one or more parcels. `phone_normalized` NOT NULL,
`arrival_date`, `message_text`, `reason` CHECK in (`initial`, `resend`), `batch_id` → send_batches NULL, `created_by`,
`created_at`. Index `phone_normalized`; (`arrival_date`, `phone_normalized`).

**9. `notification_parcels`**: `notification_id` → notifications, `parcel_id` → parcels; PRIMARY KEY (both); index `parcel_id`.

**10. `sms_attempts`**: each hand-over to the gateway. `id` TEXT PK (UUID, also the gateway message ID), `notification_id`,
`attempt_no`, `state` CHECK in (`queued`, `submitting`, `submitted`, `sent`, `delivered`, `failed`, `unconfirmed`,
`cancelled`), `gateway_state`, `error_code`, `error_detail`, `queued_at`, `submitted_at`, `sent_at`, `delivered_at`,
`failed_at`, `last_checked_at`, `resolved_by`. UNIQUE (`notification_id`, `attempt_no`); index `state`.

**11. `contact_attempts`**: calls, Telegram hand-offs, follow-up flags. `channel` CHECK in (`call`, `telegram`, `other`,
`flag`), `outcome` CHECK in (`reached`, `no_answer`, `attempted`, `messaged`, `follow_up`), `note`, `phone_normalized`,
`created_by`, `created_at`. Index `phone_normalized`.

**12. `contact_attempt_parcels`**: `contact_attempt_id`, `parcel_id`; PRIMARY KEY (both); index `parcel_id`.

Phone numbers and message bodies live only in tables 1, 6, 8, 11 (and the parcel's import evidence in 3). Access: only
through server route handlers that check the session (Phase 2); no route returns them to a signed-out request; no bulk export
in V1; the database file, backups and logs are readable only by the account running the app (mode 0700 folders) and
backups are encrypted (Phase 3).

### System

**13. `settings`**: `key` TEXT PK, `value` JSON, `updated_by`, `updated_at`. Holds column mapping, folder, templates,
sending rate, duplicate-file rule. The Shopee filter is code, never a setting. No secrets.

**14. `users`**: `username` UNIQUE, `password_hash` (scrypt), `disabled` 0/1, `created_at`.

**15. `sessions`**: `token_hash` TEXT PK, `user_id` → users, `created_at`, `expires_at`, `last_seen_at`. Index `user_id`.

**16. `audit_log`**: who did what, with safe metadata only.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `at` | TEXT NOT NULL | UTC timestamp |
| `user_id` | → users, NULL | NULL = system |
| `action` | TEXT NOT NULL | e.g. `import.checked`, `import.confirmed`, `parcel.phone_edited`, `send.started`, `sms.resolved`, `contact.recorded`, `settings.changed`, `login.succeeded` |
| `entity` | TEXT NOT NULL | e.g. `import`, `parcel`, `notification`, `send_batch` |
| `entity_ids` | TEXT JSON NOT NULL | affected record IDs, e.g. `[812]` or `{ "import": 31, "parcels": [5, 6] }` |
| `outcome` | TEXT CHECK in (`ok`, `failed`, `refused`) NOT NULL | |
| `detail` | TEXT JSON NOT NULL DEFAULT `{}` | safe metadata only: counts, rule IDs, status changes, settings keys changed, error codes, file name and SHA-256 |

Never in `audit_log`: full phone numbers (old or new), message bodies, recipient names, passwords, session tokens, gateway or
backup credentials. Before and after values of a phone edit are in `parcel_phone_changes`; message text is in
`notifications`. The audit service builds `detail` from an allow-list of keys, and a test rejects any value shaped like a
phone number. Index `at`; (`entity`, `at`). No UPDATE or DELETE (triggers).

**17. `worker_lease`**: single row (`id` CHECK = 1), `holder`, `expires_at`.

**18. `backup_runs`**: `at`, `kind` CHECK in (`local`, `off_machine`, `restore_drill`, `pre_migration`), `drive` CHECK in
(`A`, `B`) NULL, `snapshot_id`, `outcome` CHECK in (`ok`, `failed`), `error`. Index (`kind`, `at`).

Tables 14–15 are created in Phase 1 but used from Phase 2 (login); 7–12 from Phase 9; 18 from Phase 1 (pre-migration
copies) and Phase 3. Creating them all in the initial migration avoids later migrations on tables that will hold real data.

## Review items: relationships and partial re-imports

```
imports 1 ──< import_review_items >── 0..1 parcels (existing_parcel_id, db duplicates only)
imports 1 ──< parcels (first_import_id)
imports 1 ──< parcel_scan_events >── 1 parcels
imports 0..1 ── rerun_of_import_id ──> imports (earlier imported row of the same sha256)
```

- **At check** the server writes the `imports` row (`status = checked`) and one review item per finding: each recipient
  conflict and case-variant spelling (blocking), each database duplicate (informational, `existing_parcel_id` set, `detail`
  marks a key-only match), each unparseable scan time (informational). The review screen reads these rows, so it survives a
  reload and is the same for upload and watched-folder files. Nothing is inserted into `parcels` at check.
- **Staff decisions** update the item: `resolution = chosen` with the chosen spelling or name/phone, or `left_out`. Leaving
  out a parcel with no finding inserts an `excluded_by_staff` item. Choosing "only parcels scanned on <date>" inserts a
  `not_chosen_scan_date` item (with `parcel_scan_date`) for each parcel on another date or with no valid scan date.
- **Confirm** (one `BEGIN IMMEDIATE` transaction) refuses while any item has `blocking = 1 AND resolution IS NULL`; otherwise
  re-checks keys against the database, creates the ready parcels (applying `chosen` values), their scan events, sets the
  counts, `confirmed_at/by` and `status = imported`, and writes the audit entry. Any error rolls all of it back and sets
  `status = failed` with the reason. Existing parcels are never updated.
- **Partial re-import**: the scan dates already imported for a file are the `chosen_scan_date`s of its `imported` rows with
  `date_choice = only_scan_date` (or all dates if any imported row used another choice). If dates remain, a new check of the
  same `sha256` is allowed with `rerun_of_import_id` pointing at the latest such row; the review shows the imported dates and
  offers only the rest. Parcels created earlier are found as database duplicates and are not touched. Earlier resolutions for
  the same key are shown from the earlier import's items as a reference; staff confirm them again. When no date remains, the
  normal duplicate-file rule applies.
- **History**: items are never deleted; a cancelled or failed import keeps its items.

## Changes from the schema table in plan Revision 3

- Added: `parcel_scan_events`, `import_review_items`; `sessions` listed as its own table. Count: 16 → **18**.
- `parcels`: `tracking_key` (UNIQUE, replaces "tracking_code UNIQUE, uppercase, spaces removed"), `import_phone_raw`,
  `phone_edited`.
- `imports`: replaced `rows_eligible`, `rows_excluded_outlet`, `skipped_existing`, `skipped_in_file`, `added`, `filter_rule`,
  `outlet_column`, `arrival_dates` with the columns above; added `rerun_of_import_id`, `detected_file_id`, `file_format`,
  `rules`, `headers_found`, `time_zone_assumed`, date-choice fields; status `reviewed` renamed `checked`, with the status rules
  above. The proposed `scan_dates_imported` column is not needed: it is derived from earlier `imported` rows.
- `audit_log`: `entity_ids` and `outcome` added; `detail` limited to safe metadata.
- `backup_runs`: kind `pre_migration` added (Phase 1 local copy before migrating).
- These were planned as a Phase 4 migration; they are part of the **initial migration**, since no production database exists.

## Migrations

- One initial migration `drizzle/0000_initial.sql` (all 18 tables, indexes, CHECKs, triggers), generated by Drizzle Kit from
  `src/server/db/schema.ts`, with triggers added by hand, and reviewed by hand. Later changes are new numbered files; committed
  files are never edited.
- `drizzle/0001_strict_local_dates.sql` (decision 39): a custom migration (`drizzle-kit generate --custom`) that refuses
  existing impossible dates and adds 9 triggers so local dates must be real calendar dates.
- The demo seed is not a migration: `npm run db:seed` (development only) inserts an `imports` row with `source = seed` and
  sample parcels from `src/lib/mock`. It refuses to run if the database holds any non-seed import or if `DATA_DIR` is the
  production path.

### Safe migration sequence

Drizzle's built-in `migrate()` (checked in the drizzle-orm 0.45.4 source) runs all pending migrations in one `BEGIN … COMMIT`
and rolls back on error, but it commits before any post-migration check could run, and SQLite ignores
`PRAGMA foreign_keys` inside a transaction. So the runner (`src/server/db/migrate.ts`) reads the same migration files with
Drizzle's `readMigrationFiles()`, keeps Drizzle's `__drizzle_migrations` table format, and applies them itself, following
SQLite's documented procedure for schema changes:

1. **Open and inspect.** Open the database, read applied migrations, compute pending ones. None pending → step 7.
2. **Copy first.** Copy the database with SQLite's online backup to `DATA_DIR/backups/pre-migration-<timestamp>.db`, run
   `PRAGMA integrity_check` on the copy, record a `backup_runs` row (`pre_migration`). Copy fails or is not `ok` → stop.
3. **Foreign keys off, outside the transaction.** `PRAGMA foreign_keys=OFF`; read it back and stop if it is still on.
4. **One transaction.** `BEGIN IMMEDIATE`; run every statement of every pending migration in order; insert each migration's
   hash and timestamp into `__drizzle_migrations`.
5. **Validate before commit.** Still inside the transaction: `PRAGMA foreign_key_check` must return no rows and
   `PRAGMA integrity_check` must return `ok`. Any statement error or any finding → `ROLLBACK`.
6. **Commit or stop.** No finding → `COMMIT`. After a rollback the database is exactly as before step 4; the runner restores
   `foreign_keys=ON`, logs the error and exits non-zero.
7. **Foreign keys on and self-test.** `PRAGMA foreign_keys=ON` (read back); self-test: all 18 tables and the migration count
   present, `PRAGMA foreign_key_check` empty, `PRAGMA quick_check` `ok`, a read of `settings`.
8. **Refuse start-up on any failure.** The start-up script starts the web server and worker only if the runner exits 0. Any
   failure in steps 2–7 leaves the app stopped with the error shown in the log and on the console; the pre-migration copy is
   kept.

The runner also refuses to start if an applied migration's recorded hash differs from the committed file (Drizzle's
migrator does not check this).

Restore after a failed migration (runbook, Phase 1): with the app stopped, the database is already unchanged by the rollback;
if a later self-test fails, replace `branch.db` (and remove `-wal`/`-shm`) with the pre-migration copy, run
`integrity_check`, fix the migration in a new commit.

## Tests

Test isolation:

- `src/server/db/test-db.ts` creates each database in a fresh `fs.mkdtempSync(os.tmpdir() + '/cb-test-')` folder (or
  `:memory:` where the file is not needed) and deletes it in `after()`. It refuses any path whose real path is not under
  `os.tmpdir()`.
- The connection module takes the database path as an argument and refuses any path inside the project folder. Only the
  start-up script reads `DATA_DIR`; tests never do, and always open databases through `test-db.ts`.
- Data: synthetic only, from `test/fixtures/` and `src/lib/mock`. No test reads `Scan_record.xls` or any path outside the
  repository and the temporary folder.
- Each test file uses its own database, so `node --test` can run files in parallel.

Migration safety tests (`src/server/db/migrate.test.ts`):

1. Fresh database: all migrations apply; the 18 tables, indexes, CHECKs and triggers exist; `foreign_key_check` empty,
   `integrity_check` `ok`; `foreign_keys` is on afterwards.
2. Idempotent: running the runner twice changes nothing and takes no second copy.
3. Upgrade with data: seed a database at the previous migration, apply the next; row counts and contents unchanged (from the
   second migration on).
4. Failing statement: a test-only migration folder whose second file fails part-way; schema, data and
   `__drizzle_migrations` equal the pre-run state; the runner exits non-zero; the copy exists and passes `integrity_check`.
5. Foreign-key violation: a test migration that leaves an orphan row; `foreign_key_check` inside the transaction finds it;
   rollback; nothing changed; exit non-zero.
6. Foreign keys restored: after success and after each failure, `PRAGMA foreign_keys` reads 1.
7. Copy failure: the copy target is unwritable; no migration statement runs; exit non-zero.
8. Start-up refusal: the start-up script, given a failing runner, starts neither the web server nor the worker.
9. Changed migration: an applied migration file edited afterwards → the runner refuses to start; committed files' hashes match
   `drizzle/meta/_journal.json` and a checked-in list.
10. Constraints and triggers: inserts breaking a CHECK, UNIQUE (`tracking_key`, review item kind) or FK fail; the import
    status rules hold (`checked` with `parcels_added > 0` is rejected); UPDATE or DELETE on `parcel_phone_changes`,
    `parcel_scan_events` and `audit_log` fails.
11. Tracking key: `S000000018`/`s000000018` collide on `tracking_key`; `00000000000017` and `AB 12` keep their zeros and space;
    `tracking_key` must equal the ASCII upper-case of `tracking_code`.
12. Scan times: `2026-10-10 07:15:00` → `2026-10-10T00:15:00.000Z`, scan date `2026-10-10`; `2026-02-30 10:00:00`,
    `2026-10-10 25:00:00`, `10/10/2026 07:00`, `46305.3` and empty text are stored as raw text with NULL parsed time and date,
    and never count as the earliest scan date; the CHECKs reject a parsed time without a date or vice versa.
13. Phone preservation: a parcel with a staff edit, then a re-import and a partial re-review containing its code with another
    phone; `phone_raw`, `phone_normalized`, `phone_edited`, `import_phone_raw` and its `parcel_phone_changes` rows unchanged.
14. Audit safety: audit entries written by every service function in the tests contain no phone-shaped value, recipient name
    or message text.
15. Isolation guard: `test-db.ts` throws for a path outside the temp folder; the connection module throws for a path in the
    project folder.

`npm test`: the script becomes `node --test "src/**/*.test.ts"`. Node 24 expands the quoted glob itself, so it works the same
from bash and from Windows `cmd`, and the existing 46 tests in `src/lib/` and the new database tests run together (checked on
Node 24.21.0: the glob finds the same 46 tests). The existing 46 tests must still pass unchanged.

## Data locations, secrets and the Phase 4 prerequisite

| Phases | Data folder | Who runs the app | Data | Secrets file |
|---|---|---|---|---|
| 1–2 (development) | `~/.local/share/campus-branch` on the ext4 system disk, mode 0700, owned by the developer account | developer account | synthetic and demo data only | none; not created in advance |
| 3 (development, backups) | same | developer account | synthetic and demo data only | `/etc/campus-branch/branch.env`, mode 0600, owned by the service account (created in Phase 3, see below) |
| from 4 (real data) | `/var/lib/campus-branch`, mode 0700, owned by the dedicated service account | the service account | real exports | `/etc/campus-branch/branch.env`, mode 0600, owned by the service account, read with `--env-file` |

- Neither folder exists yet. Phase 1 creates the development folder (no sudo).
- Never inside the project folder: it is on NTFS with `allow_other`, where permissions are not enforced.
- **Mandatory Phase 4 prerequisite** (before any real customer data or production import is permitted; the existing gates are
  unchanged): a dedicated, non-login service account exists; `/var/lib/campus-branch` is owned by it with mode 0700;
  `/etc/campus-branch` exists and `branch.env` is mode 0600 owned by it; the production instance (app and worker) runs as that
  account with `DATA_DIR=/var/lib/campus-branch`; the development folder holds no real data. You create these with sudo from a
  written step; the check is recorded before the first real export is imported.
- **When restricted configuration becomes mandatory**: as soon as the app or a script needs any secret, it must come from a
  mode-0600 file outside the project read with `--env-file`, never from the project folder, `.env.local`, the database or
  Settings. The first secret is the restic repository password in **Phase 3**. Later secrets: gateway URL and password
  (Phase 8).
- **Phase 3 service-account setup** (decision 37): during Phase 3, before the restic password is created or used, you create
  (with sudo, from a written step) the dedicated non-login service account, `/etc/campus-branch` and
  `/etc/campus-branch/branch.env` owned by the service account with mode 0600. The password is generated directly into that
  file; no temporary user-owned secrets file is ever used, and the password never appears in the project folder, shell
  history, chat or logs. The backup job reads it as the service account. The paper copy stays as planned.
- **This setup does not authorise real customer imports.** Development data stays synthetic until the Phase 4 prerequisite
  (`/var/lib/campus-branch` owned by the service account, production app and worker running as it) is checked and recorded and
  the unchanged Phase 4 gate is followed.

## Security note: esbuild via drizzle-kit

- Finding (2026-10-12, npm registry and advisory database): `drizzle-kit@0.31.11` → `@esbuild-kit/esm-loader@2.6.5` →
  `@esbuild-kit/core-utils@3.3.2` → `esbuild@~0.18.20`. **GHSA-67mh-4wv8-2f99** (medium): esbuild ≤ 0.24.2 lets any website send
  requests to esbuild's development server and read the response; fixed in 0.25.0. Both `@esbuild-kit` packages are deprecated
  ("Merged into tsx"). drizzle-kit's direct `esbuild` (^0.25.4) is not affected.
- Exposure: development only (`devDependencies`); drizzle-kit uses esbuild to load the schema file and never starts esbuild's
  development server; production installs use `npm ci --omit=dev`, so it is never on the production machine.
- Verification at Phase 1 install: `npm ls esbuild` and `npm audit` (full) recorded in the Phase 1 log; `npm audit --omit=dev`
  must show no high or critical findings; check for a newer stable drizzle-kit without `@esbuild-kit`.
- Remediation: accepted for development; switch to a drizzle-kit release without `@esbuild-kit` when one is stable (after the
  14-day wait). Not chosen: an npm `overrides` forcing esbuild 0.25 under `@esbuild-kit/core-utils`, which pins the 0.18 API.

## Decisions

| # | Decision | Status |
|---|---|---|
| 31 | Schema: the 18 tables above, as the Phase 1 initial migration; `import_phone_raw` and `phone_edited` on `parcels`; `parcel_phone_changes` append-only; status `reviewed` renamed `checked` with the status rules above; audit log without phone numbers or message bodies | Approved 2026-10-12 |
| 32 | Import schema additions in the initial migration, not a Phase 4 migration | Approved 2026-10-12 |
| 33 | Separate `import_review_items` table for conflicts, chosen spellings, left-out parcels and partial re-imports | Approved 2026-10-12 |
| 34 | Development data `~/.local/share/campus-branch` (0700, synthetic data, Phases 1–3); no development secrets file while none is needed; service account and `/var/lib/campus-branch` a mandatory Phase 4 prerequisite (the service account itself is created earlier, in Phase 3, by decision 37) | Approved 2026-10-12 |
| 35 | esbuild advisory via drizzle-kit accepted for development with the install-time verification; replaced when drizzle-kit drops `@esbuild-kit` | Approved 2026-10-12 |
| 36 | Safe migration sequence and the tests above; `npm test` runs `src/**/*.test.ts` | Approved 2026-10-12 |
| 37 | Phase 3 secrets: service account and `/etc/campus-branch/branch.env` (service account, 0600) created during Phase 3 before the restic password exists; password stored there directly; no temporary user-owned secrets file; does not authorise real imports | Resolved 2026-10-12 |
| 38 | Review decisions (finding I3): staff may revise an item's decision any number of times while its import is `checked`; Confirm, cancel or failure freezes it. Each decision is audited with `item_kind`, `resolution_from`, `resolution_to` only, never names, phones or message text | Approved 2026-10-14 |
| 39 | Local dates (finding I2): must be real calendar dates (`date(x) IS x`), enforced by triggers in migration 0001; leap days follow the Gregorian calendar | Approved 2026-10-14 |

## Implementation notes (2026-10-12)

Files: `src/server/db/` (`schema.ts`, `connection.ts`, `migrate.ts`, `paths.ts`, `values.ts`, `audit.ts`, `parcels.ts`,
`seed.ts`, `test-db.ts` and five `*.test.ts`; since the review also `review-items.ts` and its test), `drizzle/0000_initial.sql` (generated, plus 18 hand-written triggers),
`drizzle/meta/`, `drizzle/migrations.sha256`, `drizzle.config.ts`, `scripts/db-migrate.ts`, `scripts/db-seed.ts`,
`scripts/start-with-db.ts`, `src/lib/mock/sample-parcels.ts` (the existing sample rows, moved unchanged so Node can load them).

Commands: `npm run db:migrate` and `npm run db:seed` (development; `DATA_DIR`, default `~/.local/share/campus-branch`,
created 0700, refused if group/other can read it or if it is inside the project), `npm run db:generate` (Drizzle Kit; after
generating, the triggers are re-checked and `drizzle/migrations.sha256` gets a line for the new file only), and
`node scripts/start-with-db.ts <command…>` (start-up gate: runs the command only if migration and self-test pass; kept
for the Phase 10 systemd units). Since the 2026-10-14 review (M1), `dev`, `dev:https`, `start` and `start:lan` run
`node scripts/db-migrate.ts &&` first, and the app opens the database only through `openVerifiedDatabase()`.

Dependencies (exact pins): `better-sqlite3` 13.0.3 (bundles SQLite 3.53.4), `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11
(dev), and `@types/better-sqlite3` 9.6.0 (dev; `better-sqlite3` ships no TypeScript types). npm 11 skipped esbuild's
install scripts; Drizzle Kit works without them.

Safeguards added while implementing, all consistent with the approved rules:

- CHECK on `imports`: `imported` also needs `date_choice` and `blocked = 0` (Confirm is refused while anything is blocked).
- Triggers: `import_phone_raw` cannot change; `phone_edited` cannot go back to 0; review items can be inserted or resolved only
  while their import is `checked`, and only their resolution fields can change.
- CHECK on `parcel_scan_events`: a parsed time is accepted only if `scan_time_raw` is a canonical, real
  `YYYY-MM-DD HH:MM:SS`, the parsed UTC time equals it minus 7 hours, and `scan_date` is its date part.
- CHECK on `parcels`: `tracking_code` has no surrounding spaces.
- The pre-migration copy is switched from WAL to a single self-contained file before its integrity check; the
  `backup_runs` row is written inside the migration transaction, so a rolled-back migration leaves no record of success.
- A brand-new empty database is not copied (nothing to lose); any database with tables is.
- Pending migrations older than an applied one are refused (`migration_out_of_order`).
- `assertInTempDir` also refuses paths inside the project, so the guard holds for a checkout under `/tmp`.
- Audit `detail` keys allowed: `count`, `counts`, `rules`, `status_from`, `status_to`, `settings_keys`, `error_code`,
  `file_name`, `sha256`, `phone_valid`, `migrations_applied`, `arrival_dates`, `source`.

Storage functions for later phases: `insertNewParcels()` (insert-only, `ON CONFLICT (tracking_key) DO NOTHING`) and
`editParcelPhone()` (phone, `phone_edited`, phone history and audit entry in one transaction). No import, login, worker or
SMS code is part of Phase 1.

## Review 2026-10-14

Formal review of `cd62115` against this spec and plan Revision 3. Owner decision: **accept Phase 1 with documented
conditions**. Before the fixes: 79/79 tests, `tsc` clean, `drizzle-kit generate` reports no drift. Two defects were
reproduced (H1, H2); none could occur yet because no app code used the database.

| ID | Severity | Finding | Status | Gate |
|---|---|---|---|---|
| H1 | High | Audit phone pattern refused ~1 in 55 real SHA-256 values (364 of 20,000), which would fail Confirm for those files | Fixed `46303ad`: `sha256` must be 64 lower-case hex; regression test with the reproduced hash | — |
| H2 | High | Pending migrations computed before the write lock: two start-ups at once applied a data migration twice and blocked every later start-up | Fixed `a135b9a`: re-read inside `BEGIN IMMEDIATE`; deterministic concurrency test | — |
| M1 | Medium | `start-with-db.ts` not wired; an app start could run on an unmigrated or refused database | Fixed `db9feed`: start scripts run `db:migrate` first; `openVerifiedDatabase()` for routes and worker | Phase 2 routes must use `openVerifiedDatabase()` |
| M2 | Medium | Missing `DATA_DIR` silently falls back to the development folder | Open | **Before Phase 4**: require `DATA_DIR` when `NODE_ENV=production`, with a test |
| L1 | Low | Seed's production guard compares unresolved paths (a symlink or bind mount gets past it) | Open | Before Phase 4: compare real paths and refuse when `NODE_ENV=production` |
| L2 | Low | Audit values are checked for phone shapes only; free-text keys (`counts`, `rules`, `file_name`) could carry a name | Partly: closed sets for the new review keys | Phase 4: a value rule per key (counts numeric, rules rule-ID pattern) |
| L3 | Low | Tests missing for indexes, several CHECKs, the migration CLI, backup-folder mode, second-file failure | Fixed `297ed1c` | — |
| L4 | Low | `start-with-db.ts` does not forward stop signals to the app | Open (npm scripts no longer use it) | Phase 10: forward SIGTERM/SIGINT or use systemd `ExecStartPre=` |
| I1 | Info | Code rollback after a later migration refuses start-up (`migration_missing`) by design | Documented | Every rollback runbook restores the pre-migration copy with the old code |
| I2 | Info | GLOB date CHECK accepted impossible dates | Fixed `d86e75e` (decision 39) | — |
| I3 | Info | Whether review decisions can be revised before Confirm | Decided and implemented `a6dc176` (decision 38) | Phase 4 Confirm uses `decideReviewItem()` |
| I4 | Info | `resolveDataDir` skips the 0700 check on Windows | Open | Phase 10: Windows folder ACLs |
| I5 | Info | `__drizzle_migrations.id` is NULL (same as Drizzle's migrator); order comes from `created_at` | Accepted | — |
| I6 | Info | A failed pre-migration copy can leave a partial file inside the 0700 backups folder | Accepted | Phase 3: backup pruning removes it |

Also to check in Phase 2: `MIGRATIONS_FOLDER` is found from the location of `paths.ts`; inside a Next.js server bundle
that location may differ, so the first database-backed route must prove `openVerifiedDatabase()` finds `drizzle/`.

Not confirmed by the review: Windows behaviour, the restore-after-failed-migration runbook (never exercised), and the
Phase 4 Confirm and worker rules (not built yet).
