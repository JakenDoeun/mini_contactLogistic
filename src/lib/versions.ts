// Versions as tagged on GitHub: vX.Y.Z for the office, vX.Y.Z-rc.N for the test VM only (owner, 2026-10-28). A tag
// ships nothing; the updater takes only a published GitHub Release (scripts/update.ts, deploy/windows/update.ps1).
const TAG = /^v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/;

export function parseVersion(v: string) {
  const m = TAG.exec(v);
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), rc: m[4] === undefined ? null : Number(m[4]) } : null;
}

/** Negative when a is older than b. A release candidate comes before its release: 0.2.0-rc.3 < 0.2.0. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`Not a version: ${x ? b : a}`);
  const rc = x.rc === y.rc ? 0 : x.rc === null ? 1 : y.rc === null ? -1 : x.rc - y.rc;
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch || rc;
}

export interface GithubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
}
export type Channel = 'office' | 'test';

/**
 * The newest published release this computer may install, when it is newer than the installed version; else null.
 * The office never takes a pre-release or an rc tag; the test VM takes both.
 */
export function pickRelease(releases: GithubRelease[], installed: string, channel: Channel): string | null {
  const usable = releases.filter((r) => {
    const v = !r.draft && parseVersion(r.tag_name);
    return v && (channel === 'test' || (!r.prerelease && v.rc === null));
  });
  const newest = usable.sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
  return newest && compareVersions(newest.tag_name, installed) > 0 ? newest.tag_name : null;
}

/** What `npm run release -- <kind>` passes to npm version. rc starts (or continues) a candidate of the next minor version. */
export function npmVersionArgs(kind: string, current: string): string[] | null {
  if (kind === 'patch' || kind === 'minor' || kind === 'major') return [kind];
  if (kind === 'rc') return parseVersion(current)?.rc != null ? ['prerelease', '--preid', 'rc'] : ['preminor', '--preid', 'rc'];
  return null;
}

/** Why a release cannot be made from this checkout, or null when it can. */
export function releaseProblem(s: { branch: string; dirty: boolean; behind: number }): string | null {
  if (s.branch !== 'main') return `Releases are made from main; this is ${s.branch}.`;
  if (s.dirty) return 'There are uncommitted changes. Commit or put them aside first.';
  if (s.behind > 0) return `main is ${s.behind} commit(s) behind GitHub. Run git pull first.`;
  return null;
}
