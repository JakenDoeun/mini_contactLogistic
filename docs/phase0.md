# Phase 0 log: framework upgrade

Plan: Campus Branch backend plan, Revision 3 (Phase 0). This file records what was actually done and verified.

## Status (updated 2026-10-13)

| Step | State |
|---|---|
| Rollback baseline | Done |
| `.gitignore`, ignore tests, pre-commit hook, baseline commit | Done (`088e5c3`) |
| Baseline tests, type check, production build, screenshots | Done |
| Node 24.21.0 | **Default since 2026-10-12**; 24.14.0 kept for rollback |
| Real export headers, Shopee filter spec, synthetic fixtures | Done (`docs/import-rules.md`, `test/fixtures/`) |
| Next.js security review of 15.5.27 | Done; one finding, see below |
| Next.js 16 upgrade | **In preparation** on branch `phase0-upgrade` (owner, 2026-10-13: development does not wait for the advisories; internal network/tailnet only). Versions are final only after the 2026-10-14 advisory review |
| Phase 1 | **Committed** (`cd62115`), built ahead of Phase 0 under the sequencing exception: 46 + 33 tests pass on a clean clone; must be re-run on the upgraded stack |
| Phase 2 | Not started; needs every Phase 0 acceptance item and the owner's approval |

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

## Next.js 16 upgrade

The owner decided on 2026-10-13 not to hold development for the 2026-10-14 security update: the upgrade is prepared
now with the newest stable release (16.4.0, PostCSS 8.5.23), and the app stays restricted to the local network or
tailnet. On or after 2026-10-14:

1. Read the release notes and every advisory; record advisory IDs and fixed versions here.
2. Check whether 15.5.27 is affected; if so, patch it first (the running app).
3. Pick the newest stable 16.x outside every advisory range; check its PostCSS is past 8.5.22; pin it exactly.
4. Add `.node-version`/`engines` (Node 24.21.0 is already the default), TypeScript 6.0.3, `@types/node` 24.19.2.
5. Clean-clone `npm ci`, tests, `tsc`, `next build`, page checks and screenshot comparison against the baseline; rollback check.

## Next.js 16.4.0 candidate (branch `phase0-upgrade`, 2026-10-13)

Clones on the ext4 disk; Next 15 (`main`) on 127.0.0.1:3101 and the candidate on 127.0.0.1:3102, compared side by side.

| Check | Result |
|---|---|
| Lockfile | Changed only `next`, `@next/env`, `@swc/helpers`, Next's PostCSS (8.4.31 → 8.5.23), `typescript`, `@types/node`, `undici-types`, `@next/swc-*`/`@img/*` binaries; added `baseline-browser-mapping` |
| `npm test` | 79 / 79 (46 existing + 33 database) |
| `tsc --noEmit` (TypeScript 6.0.3) | clean after `"types": ["node"]` |
| `next build` (Turbopack) | ok, 13 routes; the one warning (project tracing from the `tailscale` CLI call) fixed with `turbopackIgnore` |
| `npm audit --omit=dev` | 0 vulnerabilities (15.5.27: 1 high, 1 moderate, PostCSS) |
| `npm audit` incl. dev | 4 moderate, esbuild via drizzle-kit (accepted, decision 35) |
| 7 pages × 1366/1024/390/360 px | 28 / 28 HTTP 200, no console errors, no sideways scrolling |
| Screenshot diff vs Next 15 | Same apart from known sample-data noise; the Dashboard "SMS waiting at the gateway" line is on screen ~1.1 s after load in both builds (sampled every 200 ms), Next 16 hydrates ~250 ms later, so screenshots catch it at different moments |
| Camera scanner, fake camera, localhost | Preview plays 1920×1080 on both builds, no errors |
| `next dev` while `next build` runs | dev uses `.next/dev` and kept serving; the "build in a copy" rule can go after the merge |

The 14-day wait in the version policy is waived for 16.4.0 (published 2026-10-06) because it fixes the PostCSS
advisories that affect 15.5.27.

## Re-verification (2026-10-14, owner instruction: proceed without waiting for the advisories)

Branch already on the tip of `main` (`a8a7409`, includes Phase 1 `cd62115`): no rebase or conflicts. 16.4.0 and
TypeScript 6.0.3 are still the newest stable releases, kept as the **provisional** choice. Fresh clones on ext4, Node 24.21.0.

| Check | Result |
|---|---|
| `npm ci` | ok. npm warns that install scripts of `esbuild` (×3, via drizzle-kit/tsx) and `better-sqlite3` are not in `allowScripts`, so they did not run; better-sqlite3 13 loads its bundled Node-API binary and every database test passes without them; `drizzle-kit check` also runs |
| `npm test` | 79 / 79 |
| `tsc --noEmit` | clean |
| `next build` | ok, 13 routes, no warnings |
| `npm audit --omit=dev` / incl. dev | 0 / 4 moderate (esbuild via drizzle-kit, accepted, decision 35) |
| 7 pages × 4 widths, Next 15 (`main`) vs candidate | 28 / 28 each: HTTP 200, no console errors, no sideways scrolling |
| Screenshot diff | 6 of 28 differ; all are sample-data order (same customers, rows swapped). Two candidate runs differ from each other on 18 of 28 by the same or more, so none is caused by the upgrade |
| Candidate on 127.0.0.1:3000 behind Tailscale Serve | `/` 307, `/dashboard` `/settings` `/scan` `/api/branch-address` `/branch-ca.crt` 200, tailnet only (Funnel off) |
| Settings checks (`/api/branch-status`) | 6 / 7 ok. **Live HTTPS check: fail** — `ENOTFOUND` for the MagicDNS name. The host resolves it (`resolvectl`: 100.106.173.28 on tailscale0); the server was started from Claude's sandbox, whose DNS does not see MagicDNS. Not attributed to the upgrade; needs confirming by the owner |

No regressions found; no code changed in this pass.

## Merge and follow-ups

Merged into `main` on 2026-10-14 with the owner's explicit approval; the items below were open at the merge and stay
open as follow-ups. The provisional versions (Next.js 16.4.0, TypeScript 6.0.3) remain provisional until the first item
is done.

- [ ] **Security advisory review — NOT done; the security gate has NOT passed.** When the announced Next.js
  advisories are published: record every ID and fixed version here, check whether 16.4.0 (and 15.5.27 on `main`) are
  affected, and if so move to the patched exact version and re-run the table above.
- [ ] Live HTTPS check: start `npm run start:lan` from a normal terminal and open Settings; expect 7 / 7.
- [ ] Camera scanner on the phone at the Tailscale address.
- [x] Owner approval to merge `phase0-upgrade` into `main` (2026-10-14).
