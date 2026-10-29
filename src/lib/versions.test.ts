import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, npmVersionArgs, pickRelease, releaseProblem, type GithubRelease } from './versions.ts';

const r = (tag_name: string, prerelease = false, draft = false): GithubRelease => ({ tag_name, prerelease, draft });

test('versions compare by number, and a release candidate comes before its release', () => {
  assert.ok(compareVersions('0.2.0', '0.1.9') > 0);
  assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
  assert.ok(compareVersions('v0.2.0-rc.3', '0.2.0') < 0);
  assert.ok(compareVersions('0.2.0-rc.10', '0.2.0-rc.2') > 0);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.throws(() => compareVersions('main', '0.1.0'), /Not a version: main/);
});

test('the office takes only the newest published full release; the test VM also takes candidates', () => {
  const releases = [r('v0.2.0'), r('v0.3.0-rc.1', true), r('v0.4.0', false, true), r('nightly'), r('v0.2.1')];
  assert.equal(pickRelease(releases, '0.1.0', 'office'), 'v0.2.1');
  assert.equal(pickRelease(releases, '0.1.0', 'test'), 'v0.3.0-rc.1');
  assert.equal(pickRelease(releases, '0.2.1', 'office'), null, 'nothing newer');
  assert.equal(pickRelease([r('v0.3.0-rc.1')], '0.2.0', 'office'), null, 'an rc tag is never for the office, even unmarked');
  assert.equal(pickRelease([r('v0.3.0', true)], '0.2.0', 'office'), null, 'a release marked pre-release is not for the office');
  assert.equal(pickRelease([r('v0.3.0')], '0.3.0-rc.2', 'test'), 'v0.3.0', 'the release follows its candidates');
  assert.equal(pickRelease([], '0.1.0', 'office'), null);
});

test('npm run release: patch, minor and major as npm has them; rc starts or continues a candidate', () => {
  assert.deepEqual(npmVersionArgs('minor', '0.1.0'), ['minor']);
  assert.deepEqual(npmVersionArgs('rc', '0.1.0'), ['preminor', '--preid', 'rc']);
  assert.deepEqual(npmVersionArgs('rc', '0.2.0-rc.0'), ['prerelease', '--preid', 'rc']);
  assert.equal(npmVersionArgs('beta', '0.1.0'), null);
});

test('a release is refused off main, with uncommitted changes, or behind GitHub', () => {
  assert.equal(releaseProblem({ branch: 'main', dirty: false, behind: 0 }), null);
  assert.match(releaseProblem({ branch: 'fix-x', dirty: false, behind: 0 })!, /from main/);
  assert.match(releaseProblem({ branch: 'main', dirty: true, behind: 0 })!, /uncommitted/);
  assert.match(releaseProblem({ branch: 'main', dirty: false, behind: 2 })!, /2 commit\(s\) behind/);
});
