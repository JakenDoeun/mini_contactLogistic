import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { backupStatus, saveBackup } from '@/server/db/backup';
import { resolveDataDir } from '@/server/db/paths';
import { retentionDays } from '@/server/db/retention';

// Settings "Backups and data" (plan Revision 4): the last backup, whether backups are failing, the retention period.
export const GET = withSession((_req, user, db) =>
  json({ ...backupStatus(resolveDataDir()), retentionDays: retentionDays(db), isAdmin: user.isAdmin }),
);

// The Save backup button: any signed-in staff member. No new file when nothing changed since the last backup.
export const POST = withSession(async (req, _user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  if (!(await readJson(req))) return json({ error: 'invalid_request' }, 400);
  const dataDir = resolveDataDir();
  try {
    saveBackup(db, dataDir);
  } catch (e) {
    console.error(`Backup failed: ${(e as Error).message}`);
    return json({ error: 'backup_failed', ...backupStatus(dataDir) }, 500);
  }
  return json(backupStatus(dataDir));
});
