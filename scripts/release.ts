// npm run release -- patch|minor|major   a version for the office (after a test candidate worked on the test VM)
// npm run release -- rc                  a test candidate, vX.Y.Z-rc.N, that only the test VM installs
// From a clean, up-to-date main: runs the tests and the type check, raises the version in package.json, commits and
// tags it, pushes after you confirm, then prints the GitHub page where you publish it. A tag alone ships nothing: the
// office updates only to a published release (owner, 2026-10-28).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { npmVersionArgs, releaseProblem } from '../src/lib/versions.ts';

const fail = (message: string): never => {
  console.error(`release: ${message}`);
  process.exit(1);
};
const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const run = (cmd: string, a: string[]) => spawnSync(cmd, a, { stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;
const version = () => (JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string }).version;

const kind = process.argv[2] ?? '';
const npmArgs = npmVersionArgs(kind, version());
if (!npmArgs) fail('usage: npm run release -- patch | minor | major | rc');

const local = { branch: git('rev-parse', '--abbrev-ref', 'HEAD'), dirty: git('status', '--porcelain') !== '' };
// The local checks first, so a wrong branch is refused before anything asks GitHub.
const problem = releaseProblem({ ...local, behind: 0 }) ?? (git('fetch', '--quiet', 'origin', 'main'), releaseProblem({ ...local, behind: Number(git('rev-list', '--count', 'HEAD..origin/main')) }));
if (problem) fail(problem);

console.log('Running the tests and the type check first…');
if (!run('npm', ['test']) || !run('npx', ['tsc', '--noEmit', '-p', '.'])) fail('the tests or the type check failed; nothing was changed');

if (!run('npm', ['version', ...npmArgs!, '-m', 'Release %s'])) fail('npm version failed');
const tag = `v${version()}`;
const repo = git('remote', 'get-url', 'origin').replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question(`Push ${tag} and main to GitHub now? [y/N] `)).trim().toLowerCase();
rl.close();
if (answer !== 'y') {
  console.log(`Not pushed. To push later: git push origin main ${tag}`);
  process.exit(0);
}
if (!run('git', ['push', 'origin', 'main', tag])) fail(`the push failed; run git push origin main ${tag} again`);

const test = tag.includes('-rc.');
console.log(`\nPushed ${tag}. Nothing is installed yet. Publish it here${test ? ' and tick "Set as a pre-release" (test VM only)' : ''}:`);
console.log(`  https://github.com/${repo}/releases/new?tag=${tag}&title=${tag}${test ? '&prerelease=1' : ''}`);
console.log(test ? 'The test VM installs it at its next start.' : 'The office installs it at its next start.');
