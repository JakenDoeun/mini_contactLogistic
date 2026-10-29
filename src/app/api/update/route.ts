import fs from 'node:fs';
import path from 'node:path';
import { json, withSession } from '@/server/auth/guard';
import { resolveDataDir } from '@/server/db/paths';
import pkg from '../../../../package.json';

const STEPS = ['download', 'build', 'wait', 'switch'];

// The version running now and what the Windows updater (deploy/windows/update.ps1) is doing, from the update.json it
// writes in the data folder: Updating (and which step) while it works beside this version, Failed when it put it back
// (retry: it tries the same version again at the next start, as after a failed download).
export const GET = withSession(() => {
  let update = null;
  try {
    const u = JSON.parse(fs.readFileSync(path.join(resolveDataDir(), 'update.json'), 'utf8').replace(/^﻿/, ''));
    if (typeof u.version === 'string' && u.state === 'updating' && STEPS.includes(u.step)) update = { state: u.state, step: u.step, version: u.version };
    else if (typeof u.version === 'string' && u.state === 'failed') update = { state: u.state, version: u.version, retry: u.retry === true };
  } catch {
    // no update.json: nothing is being updated
  }
  return json({ version: pkg.version, update });
});
