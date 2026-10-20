# Phase 10 log: hardening and service

Branch `phase10-hardening` (from main `c56620c`). Authorised by the owner on 2026-10-20 ("start phase 10"). Synthetic
data only.

## Done

- **The last browser-only settings are on the server.** The export's tracking and phone column headings, the
  duplicate-file rule and the SMS wording were saved in each browser, so the importer never saw them (it read its own
  `import.columns` and `import.duplicate_file`, which nothing wrote) and two staff could send different wording. Now
  `GET /api/settings` (any staff) and `PUT /api/settings` (admin only) in `src/server/settings/app-settings.ts`. Every
  field is checked before anything is written; the audit names the keys, never the values. The form now starts from
  the importer's real defaults ("scan order number", "consignee mobile") instead of the old browser ones. Wording
  saved in a browser before Phase 10 is not carried over: the admin types it once in Settings.
- **`src/lib/mock/` holds no stores any more.** `settings-service.ts` and `use-settings.ts` are replaced by
  `src/lib/settings-service.ts`; only `sample-parcels.ts` (the development seed) is left. The "Preview, remembered in
  this browser only" note on Settings is gone.
- **Review item I4: the Windows data folder's access list is checked.** On Windows the app reads the folder's access
  list (`icacls /save`, as SIDs, so any Windows language works) once per process and refuses to start if Users,
  Everyone, Authenticated Users, Interactive users or Guests may open it. The installer's list (the app's account,
  Administrators, SYSTEM, inheritance off) passes. Not yet run on Windows (see Open).
- **One settings helper** (`src/server/db/settings.ts`) replaces three copies in folder, gateway and SMS code.
- **Tailnet rules written** in `docs/tailnet-rules.md`, for the owner to apply in the admin console: staff devices
  reach only the office computer on 443; only the office computer reaches the gateway phone on 8080.
- **Restore drill, Linux**: on a scratch data folder, a backup restored with `npm run restore -- 1` set the SMS hold
  with the copy's time and printed the staff instruction.

## Tests

- Unit: 185 (shared settings start from the importer's defaults, the admin's save reaches the importer and leaves
  other columns alone, staff are refused, a bad field saves nothing, the audit holds keys only; the access-list check
  refuses ProgramData's inherited Users entry and Everyone/Authenticated Users, ignores deny entries, and passes the
  installer's list).
- Headless Chromium on a scratch build: Settings shows the importer's defaults; the admin saves a column heading, sees
  "Saved for every staff member", and a second browser shows the same value; the database holds it; no browser errors.

## Open

- **No Windows test VM right now.** The VM used in Phases 3–5 ("Wins 10", tailnet name wins10) is no longer in
  VirtualBox. Needed for: the I4 check on a real Windows folder, a clean install from this branch, and the restore and
  reboot drill. Either a test VM again, or these run on the branch laptop.
- Tailnet rules: the owner applies them (admin console) and runs the checks in `docs/tailnet-rules.md`.
- Linux install stays paused (Revision 5).

## Gate

- [ ] Reboot and restore pass on Windows (the branch laptop, or a test VM): the app comes back by itself after a
  reboot; a restore holds SMS until staff check the phone; the data folder's access list passes the I4 check.
- [ ] Tailnet rules applied and checked.
