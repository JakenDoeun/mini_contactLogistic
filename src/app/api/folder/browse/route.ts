import fs from 'node:fs';
import os from 'node:os';
import { json, withSession } from '@/server/auth/guard';
import { browseFolder } from '@/server/folder/folder';

// Settings: list the subfolders of ?path= on the branch computer. No ?path = home; ?path= (empty) = the drives. Admin only.
export const GET = withSession((req, user) => {
  if (!user.isAdmin) return json({ error: 'not_admin', message: 'Only the admin account can change the watched folder.' }, 403);
  const at = new URL(req.url).searchParams.get('path');
  // The service account's home may not exist yet; the drives are always there.
  const home = fs.existsSync(os.homedir()) ? os.homedir() : null;
  const result = browseFolder(at === null ? home : at || null);
  return result.ok ? json(result) : json({ error: 'invalid', message: result.message }, 400);
});
