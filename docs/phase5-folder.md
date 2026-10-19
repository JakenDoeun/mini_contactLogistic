# Phase 5 log: the watched folder

Branch `phase5-folder` (on top of `phase4-imports`). Synthetic files only, like Phase 4.

## Decisions (owner, 2026-10-19)

- **Automatic checks are off by default.** The main way in is **Scan Folder Now** on Import Arrivals. It checks the same
  folder the automatic check uses. The admin can turn automatic checks on in Settings (every 30 s, 1, 2 or 5 minutes).
- Found files are never imported on their own. Each one waits for a staff member to open its review and confirm it.

## How it works

- `src/server/folder/folder.ts`: one scan routine for both triggers.
  - A file counts once its size and modified time stay the same for 2 seconds, it is not empty, and it can be read whole.
    Until then it is "still being saved". Excel's `~$` lock files and other file types are ignored.
  - Each finished file becomes one `detected_files` row (unique on path, size and modified time), with its SHA-256.
    A copy whose content was already imported is recorded as imported.
  - A file that is removed, or changed after it was found, drops off the list. Its new version is found by the next scan.
  - Reviewing a found file runs the same check as a manual upload (`checkImport`, source `folder`). Confirm marks the
    file imported. Opening it again resumes the open review instead of starting another.
- **Scan Folder Now** runs in the web app (`POST /api/folder/scan`). **Automatic checks** run in the launcher
  (`scripts/serve.ts`) next to backups and retention: at start-up, then at the chosen interval. `npm run dev` has no
  launcher, so in development only Scan Folder Now finds files.
- Not used, compared with the plan: a separate worker process and chokidar. The launcher already runs the timed jobs,
  and listing one folder every 30 s or more is cheap, works the same on network shares, and adds no dependency. The
  single-worker lease is left for the SMS queue (Phase 9), where two senders would matter.
- **Settings** (admin only, audited without the path): the folder, automatic checks on or off, the interval. The folder
  must exist and be readable by the app, otherwise saving says why.
- **Windows installer**: creates `C:\Users\Public\Documents\Campus Branch Imports`. Staff signed in at the computer can
  save into it, and the app's account can read it. Nobody else can. A "Campus Branch Imports" shortcut goes on every
  user's desktop. It is the default folder on Windows. A user's own Downloads folder would not work, because the app's
  account cannot read it.
- API: `GET /api/folder`, `POST /api/folder/scan`, `POST /api/folder/files/<id>/check`,
  `POST /api/folder/files/<id>/dismiss`, `PUT /api/settings/folder`. All require sign-in; the integration test checks
  every route refuses signed-out requests.

## Tests

- Unit (`src/server/folder/folder.test.ts`): off by default, admin only, unusable folders refused; a file found once,
  nothing imported; review, confirm, and a renamed copy recognised as imported; a changed file refused; a dismissed file
  stays dismissed; a missing folder reported; a file growing during the scan is "still being saved", then found.
- Integration (`test/integration/app.test.ts`): the real launcher with automatic checks on finds a file saved while it
  was stopped and one saved while it runs; nothing is imported.
- Browser, scratch build (headless Chromium): Settings saves the folder and refuses a missing one; Scan Folder Now
  finds two files; one opens the review marked "Watched folder"; closing it shows "Continue review"; the failing one
  shows why and can be taken off the list; the panel fits at phone width.

## Gate

Files dropped while running and while stopped are detected and never imported on their own.

Windows test VM, 2026-10-19 (installer run from this branch). Recorded, not ticked: ticks wait for the branch laptop.

- [ ] Shared folder created with the intended permissions: SYSTEM and Administrators full, Users modify,
  `campusbranch` read. Desktop shortcut present. (VM: as intended.)
- [ ] Automatic checks on, file saved while running: found by the app's own account. (VM: found 11 s after it was
  saved, state waiting, 0 imports.)
- [ ] File saved while the app was stopped: found at start-up. (VM: found 5 s after the task started, 0 imports.)
- [ ] Scan Folder Now in the browser on the branch laptop finds a file saved to the shared folder, and its review
  and confirm work.

The VM was put back afterwards: test files removed, automatic checks back to off, the test entries off the list.
