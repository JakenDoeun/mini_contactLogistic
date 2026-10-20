// npm run sms-worker — the SMS worker on its own, for development beside `npm run dev` (the launcher, npm run serve,
// runs the same worker in production). Stops with Ctrl+C.
import path from 'node:path';
import { openVerifiedDatabase } from '../src/server/db/migrate.ts';
import { resolveDataDir } from '../src/server/db/paths.ts';
import { smsWorker } from '../src/server/sms/worker.ts';

const db = openVerifiedDatabase(path.join(resolveDataDir(), 'branch.db'));
const sms = smsWorker(db, resolveDataDir(), (line) => console.log(`[sms ${new Date().toISOString()}] ${line}`));
const timer = setInterval(() => void sms.tick(), 2_000);
void sms.tick();
console.log('SMS worker running. Ctrl+C to stop.');
for (const s of ['SIGINT', 'SIGTERM'] as const) {
  process.on(s, () => {
    clearInterval(timer);
    sms.release();
    db.close();
    process.exit(0);
  });
}
