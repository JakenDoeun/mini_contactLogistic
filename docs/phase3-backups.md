# Phase 3: backups, data retention, start at boot

Plan Revision 4, approved by the owner on 2026-10-17. Campus Branch is an internal tool for one or two staff accounts and
keeps customer data for at most 14 days, so backups stay on this computer. A lost or broken computer is handled by
reinstalling and importing the courier file again (see "Rebuild" below), not by an off-machine copy.

## What runs

| Part | Where | What it does |
|---|---|---|
| Save setting | `src/server/db/connection.ts` | `synchronous = FULL` (a record shown as saved survives a power cut) and `secure_delete = ON` (deleted rows are overwritten) on every connection |
| Backups | `src/server/db/backup.ts` | `VACUUM INTO` a temporary file, `integrity_check`, fsync, rename to `backups/backup-<Cambodia time>+07.db` (0600, folder 0700). No new file when the data is unchanged (identical bytes). Kept 7 days (owner, 2026-10-17); the newest is always kept; stale temporary files are removed (finding I6) |
| Pre-migration copy | `src/server/db/migrate.ts` | the same checked copy, as `pre-migration-<time>.db`, before any migration |
| Retention | `src/server/db/retention.ts` | parcels whose arrival date is N days old or more (Cambodia date; N = 7 by default, 1–14, admin only) are deleted with their scan events, phone changes, messages, SMS attempts, contact notes, review items, imports, detected files and stored import files; the activity log and backup history of that period too. Accounts, settings and templates stay. One transaction, foreign keys checked before commit, then WAL truncate and `VACUUM` |
| Launcher | `scripts/serve.ts` (`npm run serve`) | migrate and self-test, retention, a backup, then `next start` on 127.0.0.1. Restarts the web app after a crash (5 s, doubling to 60 s). Backup 5 minutes after the last change, at most every 15 minutes; retention every hour. On Ctrl+C, a service stop or a Linux shutdown it saves a backup before exiting |
| Restore | `scripts/restore.ts` (`npm run restore`) | lists backups; `npm run restore -- <n>` refuses while `serve` runs, saves the current database as `before-restore-<time>.db`, puts the chosen copy back, migrates it if older, and deletes expired data before the app opens it |
| Settings | `src/components/settings/backup-card.tsx`, `/api/backup`, `/api/settings/retention` | "Last backup today at 14:02", red "Backups are failing. Tell the admin." after two failed runs in a row, the Save backup button (any staff member), and the retention setting (admin only, audited) |
| Admin | migration `drizzle/0003_retention.sql` | `users.is_admin`; the first account is the admin. The append-only tables refuse deletes except inside the retention job's transaction |

The Windows shutdown can end the app without warning, so the backup on stop is not guaranteed there; the backup 5
minutes after the last change and the start-up backup cover it. Nothing saved is lost either way (`FULL`).

## Install (start at boot, no login, no terminal for staff)

Build in a clean folder, never in a folder where `npm run dev` is running: `git clone`, `npm ci`, `npm run build`.

**Windows (primary).** In PowerShell as administrator, from the built folder:
`powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1`. It creates the hidden standard account
`campusbranch` (random password given only to Task Scheduler), `C:\ProgramData\CampusBranch` (only that account,
Administrators and SYSTEM), and the task "Campus Branch" (at startup, whether or not anyone is logged on, no time limit,
on battery too, restart on failure). It sets the critical battery action to Hibernate. Check "Set time automatically"
is on, and run `tailscale serve --bg 3000` once.

**Linux.** `sudo sh deploy/linux/install.sh [path to Node 24]`. It creates the non-login account `campus-branch`,
`/var/lib/campus-branch` (0700), copies the app to `/opt/campus-branch/app` and Node to `/opt/campus-branch/node`, and
enables `campus-branch.service` (`Restart=on-failure`, stop by SIGTERM with 30 s for the stop backup).

Disk encryption (BitLocker or Device encryption) is left off by owner decision on 2026-10-17; it can be turned on later
in Windows without any change to the app.

## Restore

1. Stop Campus Branch: Windows `Stop-ScheduledTask 'Campus Branch'`, Linux `sudo systemctl stop campus-branch`.
2. List the backups (Cambodia time, newest first), from the app folder:
   - Windows, PowerShell as administrator: `$env:DATA_DIR = "$env:ProgramData\CampusBranch"; npm run restore`
   - Linux, as the app account so the files stay its own:
     `cd /opt/campus-branch/app && sudo -u campus-branch env DATA_DIR=/var/lib/campus-branch /opt/campus-branch/node/bin/node scripts/restore.ts`
3. Run the same command with the backup's number at the end (`npm run restore -- 2`, or `... scripts/restore.ts 2`). The
   current database is kept as a before-restore copy first.
4. Start Campus Branch again: `Start-ScheduledTask 'Campus Branch'`, or `sudo systemctl start campus-branch`.

## Rebuild after losing the computer

Install on another computer as above, create the first account on the first-run screen, set the retention again if it
was changed, and import today's courier file. Lost: SMS status and history of the last few days, and any other account.

## Phase 3 gate

Automated (`npm test`, `npm run test:integration`) on Linux:

- [x] Copies are checked, 0600 in a 0700 folder, consistent while another connection writes, not repeated without changes
- [x] Copies older than 7 days and stale temporary files are removed; the newest stays
- [x] Two failed runs in a row turn the status red; a success clears it
- [x] The scheduler copies 5 minutes after the web app's last change, at most every 15 minutes, never without changes
- [x] Retention removes expired parcels and everything about them, keeps recent ones, accounts and settings; the deleted
      text is absent from the database file and the WAL; a failure rolls everything back
- [x] Outside the retention job, the append-only tables still refuse deletes
- [x] Only the admin changes retention (1–14), audited; any staff member can save a backup; cross-site requests refused
- [x] Restore lists, refuses while `serve` runs, keeps the current database, puts the chosen copy back, is audited
- [x] `serve` migrates, starts the app, restarts it after it is killed, and saves a backup when stopped

On the devices, confirmed by the owner (Windows first, then Linux):

- [ ] Cold boot with nobody logged in: the app answers on the Tailscale HTTPS address within 3 minutes
- [ ] Ending the web app's process in Task Manager (or `kill`): it is back within 1 minute
- [ ] The data folder cannot be opened by another account
- [ ] After a night switched off, a new backup appears within 5 minutes of boot if data changed
- [ ] Power pulled while saving: after restart every record shown as saved is there and the database checks ok
- [ ] Backups folder made unwritable: the red line appears after 2 failures; scanning and contacting still work
- [ ] Restore by following the steps above
- [ ] Rebuild on a second machine within 30 minutes from the steps above
