import { json, withSession } from '@/server/auth/guard';
import { resolveDataDir } from '@/server/db/paths';
import { gatewayStatus, refreshTestSms } from '@/server/gateway/status';

// The gateway as Settings shows it: set up or not, reachable, password, the phone's checks and clock, the last test SMS.
// Its address goes to the admin only (owner, 2026-10-22, acceptance row 26).
export const GET = withSession(async (_req, user, db) => {
  const dataDir = resolveDataDir();
  const [status, test] = await Promise.all([gatewayStatus(dataDir), refreshTestSms(db, dataDir)]);
  return json({ ...status, ...(!user.isAdmin && { url: undefined }), test, isAdmin: user.isAdmin });
});
