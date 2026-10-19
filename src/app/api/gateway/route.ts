import { json, withSession } from '@/server/auth/guard';
import { resolveDataDir } from '@/server/db/paths';
import { gatewayStatus, refreshTestSms } from '@/server/gateway/status';

// The gateway as Settings shows it: set up or not, reachable, password, the phone's checks and clock, the last test SMS.
export const GET = withSession(async (_req, user, db) => {
  const dataDir = resolveDataDir();
  const [status, test] = await Promise.all([gatewayStatus(dataDir), refreshTestSms(db, dataDir)]);
  return json({ ...status, test, isAdmin: user.isAdmin });
});
