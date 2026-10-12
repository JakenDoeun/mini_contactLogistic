# Phase 0 log: framework upgrade

Plan: Campus Branch backend plan, Revision 3 (Phase 0). This file records what was actually done and verified.

## Status (2026-10-12)

| Step | State |
|---|---|
| Rollback baseline | Done |
| `.gitignore`, ignore tests, pre-commit hook, baseline commit | Done (`088e5c3`) |
| Baseline tests, type check, production build, screenshots | Done |
| Node 24.21.0 | **Default since 2026-10-12**; 24.14.0 kept for rollback |
| Real export headers, Shopee filter spec, synthetic fixtures | Done (`docs/import-rules.md`, `test/fixtures/`) |
| Next.js security review of 15.5.27 | Done; one finding, see below |
| Next.js 16 upgrade | **Blocked** until the 2026-10-14 advisories are published and checked |
| Phase 1 | Not started; needs every Phase 0 acceptance item |

## Rollback baseline

- Source snapshot (without `node_modules`, `.next`): `~/campus-branch-backup-2026-10-12/project-baseline-2026-10-12T0742Z.tar.gz`, mode 0600, SHA-256 `499840bd925f415769f6ec57c2f98f7803f9ddf361090ee551fbda4ab8d0f0d9` (also in that folder's `SHA256SUMS`).
- Git baseline: commit `088e5c3` on `main`. Rollback of any later Phase 0 change: `git revert` or `git checkout 088e5c3 -- .`, then `npm ci`.

## Git and secrets

- `.gitignore` rewritten (secrets, customer data, databases, backups, logs, exports, build output, local tool state).
- Verified with `git check-ignore`: 20 sample names that must be ignored are ignored (`branch.env`, `.env.local`, `x.db`, `x.db-wal`, `export.xlsx`, `certificates/localhost-key.pem`, `logs/a.log`, `data/…`, `backups/…`, `uploads/…`, `*.pem`, `*.key`, …); `deploy/branch.env.example`, `test/fixtures/*.csv|xlsx`, `package-lock.json` stay tracked.
- `git add --dry-run` reviewed (98 files); secret-pattern scan found nothing.
- `.git/hooks/pre-commit` (local, not versioned) refuses env files, databases, exports outside `test/fixtures/`, keys and private-key or Tailscale-key content. Tested: blocks `.env.*` + `.xlsx`, blocks a PEM private-key header in staged content, allows `test/fixtures/*.csv`.
- Git set `core.fileMode=false` itself (the project is on an NTFS drive); all files are committed as 100644.
- `Tailscale.md` deliberately left untracked (open decision 22); it holds no secrets.

## Baseline results (clean clone, `npm ci` from the committed lockfile)

| Check | Node 24.14.0 (current) | Node 24.21.0 |
|---|---|---|
| `npm ci` | ok, lockfile unchanged | ok, lockfile unchanged |
| `npm test` | 46 / 46 pass | 46 / 46 pass |
| `tsc --noEmit` | clean | clean |
| `next build` (15.5.27) | ok, 14 routes, no warnings | ok, no warnings |
| 7 pages × 1366/1024/390/360 px on `next start` | 28 / 28 HTTP 200, no console errors, no sideways scrolling | same |

Screenshots and the page report are kept outside the project (session scratch folder) for comparison with the Next.js 16 build.
Differences between the two runs were only sample-data noise: generated file names follow the clock, and two sample parcels
imported milliseconds apart swap their name order. The Next.js 16 comparison ignores both.

Builds ran in clones on the ext4 disk, never in the project folder, so the dev server's `.next` was untouched.

## Node 24.21.0 (default)

- Installed with nvm: `nvm install 24.21.0`; nvm verified the download checksum ("Checksums matched!"). npm 11.19.0.
- The nvm default was `lts/*`, which follows the newest installed LTS and would have switched silently on install (and could jump
  to Node 26 after 2026-10-28). It is now pinned: `nvm alias default 24.14.0`.
- **Switched 2026-10-12** (app not running): `nvm alias default 24.21.0`. A new login shell shows node v24.21.0, npm 11.19.0.
  In the project on 24.21.0: `npm test` 46 / 46 pass, `tsc --noEmit` clean. Restart the dev server from a new terminal.
- **Roll back**: `nvm alias default 24.14.0` (24.14.0 stays installed). To restore the old floating behaviour: `nvm alias default lts/*`.
- `.node-version` and `engines` are still not added; they come with the Next.js 16 upgrade (step 4 below).

## Security review of the installed Next.js 15.5.27 (2026-10-12)

- GitHub Advisory Database, newest `next` advisory published 2026-10-07; none of its `next` advisories lists 15.5.27 in an affected range.
- `npm audit --omit=dev`: 1 high, 1 moderate, both from **PostCSS 8.4.31 pinned inside Next.js 15.5.27**:
  GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 (fixed after 8.5.22).
- No 15.5.x release fixes it (newest backport is 15.5.27). Next.js 16.3.8 and 16.4.0 ship PostCSS 8.5.23. Tailwind already uses 8.5.29.
- Exposure: Next's PostCSS processes only this app's own CSS at build time; the advisories need attacker-controlled CSS. Low practical risk.
- Decision: no override of Next's pinned PostCSS; the fix is the Next.js 16 upgrade behind the security gate. Must be resolved before real data.

## Blocked: Next.js 16 upgrade

Waiting for the official 2026-10-14 security update. When it is out:

1. Read the release notes and every advisory; record advisory IDs and fixed versions here.
2. Check whether 15.5.27 is affected; if so, patch it first (the running app).
3. Pick the newest stable 16.x outside every advisory range; check its PostCSS is past 8.5.22; pin it exactly.
4. Add `.node-version`/`engines` (Node 24.21.0 is already the default), TypeScript 6.0.3, `@types/node` 24.19.2.
5. Clean-clone `npm ci`, tests, `tsc`, `next build`, page checks and screenshot comparison against the baseline; rollback check.
