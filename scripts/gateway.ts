// npm run gateway -- set     ask the gateway app's address, username and password, check them, then save them
// npm run gateway -- show    print the saved address and username (never the password)
// Run on the office computer. The values go to gateway.json in DATA_DIR (default ~/.local/share/campus-branch), mode
// 0600: never the database or Settings. Add --save-anyway to save values the phone cannot confirm right now.
import path from 'node:path';
import readline from 'node:readline';
import { writeAudit } from '../src/server/db/audit.ts';
import { openVerifiedDatabase } from '../src/server/db/migrate.ts';
import { resolveDataDir } from '../src/server/db/paths.ts';
import {
  DELETE_AFTER_DAYS,
  GATEWAY_FILE,
  GatewayError,
  gatewayConfigErrors,
  readGatewayConfig,
  smsGate,
  writeGatewayConfig,
} from '../src/server/gateway/smsgate.ts';

const [command, ...flags] = process.argv.slice(2);
if (!['set', 'show'].includes(command)) {
  console.error('Usage: npm run gateway -- set [--save-anyway] | show');
  process.exit(2);
}

const dataDir = resolveDataDir();
const file = path.join(dataDir, GATEWAY_FILE);

try {
  const saved = readGatewayConfig(dataDir);
  if (command === 'show') {
    console.log(saved ? `Address: ${saved.url}\nUsername: ${saved.username}\nPassword: saved (not shown)\nFile: ${file}` : `Not set up. Run npm run gateway -- set.`);
    process.exit(0);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  let hidden = false;
  // Keeps the typed password off the screen; everything else echoes as usual.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
    if (!hidden) process.stdout.write(s);
  };
  // Lines in order, so answers piped in all at once are not lost between questions.
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question: string, secret = false) => {
    process.stdout.write(question);
    hidden = secret;
    const { value } = await lines.next();
    hidden = false;
    process.stdout.write(secret || !process.stdin.isTTY ? '\n' : '');
    return String(value ?? '').trim();
  };

  console.log('Values from the gateway app: Settings › Local Server (address and port, username, password).');
  const url = (await ask(`Address${saved ? ` [${saved.url}]` : ', for example http://phone-name:8080'}: `)) || saved?.url || '';
  const username = (await ask(`Username${saved ? ` [${saved.username}]` : ''}: `)) || saved?.username || '';
  const password = (await ask(`Password${saved ? ' [keep the saved one]' : ''}: `, true)) || saved?.password || '';
  rl.close();

  const config = { url, username, password };
  const errors = gatewayConfigErrors(config);
  if (errors.length) throw new Error(errors.join(' '));

  console.log('Checking with the gateway phone…');
  try {
    const gate = smsGate(config);
    const health = await gate.health();
    await gate.checkLogin();
    const changed = await gate.ensureDeleteAfter();
    console.log(`Connected. SMSGate ${health.version ?? '(version unknown)'}; phone checks ${health.ready ? 'pass' : 'NOT all passing'}.`);
    console.log(changed ? `Set the phone to delete sent messages after ${DELETE_AFTER_DAYS} days.` : `The phone already deletes sent messages after ${DELETE_AFTER_DAYS} days.`);
  } catch (e) {
    if (!(e instanceof GatewayError)) throw e;
    if (!flags.includes('--save-anyway')) throw new Error(`${e.message} Nothing was saved. Fix it, or run again with --save-anyway.`);
    console.log(`${e.message} Saving anyway, as asked.`);
  }

  writeGatewayConfig(dataDir, config);
  const db = openVerifiedDatabase(path.join(dataDir, 'branch.db'));
  try {
    writeAudit(db, { action: 'settings.changed', entity: 'settings', entityIds: [], outcome: 'ok', userId: null, detail: { settings_keys: ['gateway'], source: 'cli' } });
  } finally {
    db.close();
  }
  console.log(`Saved to ${file} (readable by this account only).`);
} catch (e) {
  console.error(`gateway ${command} failed: ${(e as Error).message}`);
  process.exit(1);
}
