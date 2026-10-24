'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CARRIER_LABEL, CARRIERS, carrierOf, simByCarrier, type Carrier, type SimInfo } from '@/lib/carriers';
import { formatPhone } from '@/lib/parcel-logic';

type Check = { description?: string; observedValue: number; status: string };
type Test = {
  id: string;
  toEnding: string;
  sentAt: string;
  state: 'Pending' | 'Processed' | 'Sent' | 'Delivered' | 'Failed' | 'Unknown' | 'Missing';
  states: Partial<Record<'Pending' | 'Processed' | 'Sent' | 'Delivered' | 'Failed', string>>;
  error: string | null;
  sim?: number | null;
};
type SimScan = { scannedAt: string | null; sims: SimInfo[]; problem: string | null };
type Status = { isAdmin: boolean; tests: Test[]; sims: SimScan } & (
  | { configured: false; problem?: string }
  | {
      configured: true;
      url?: string; // admin only
      problem: { kind: 'unreachable' | 'timeout' | 'auth' | 'refused'; message: string } | null;
      health: { ready: boolean; version: string | null; checks: Record<string, Check>; clockOffsetSeconds: number | null } | null;
      deleteAfterSet: boolean;
      deleteAfterDays: number;
      clockLimitSeconds: number;
    }
);

const PROBLEM_HELP = {
  unreachable: 'Check that the phone is on, SMSGate shows “Stop service” on its Home tab, and Tailscale is connected on both.',
  timeout: 'The phone may be asleep or on a weak connection. Check it, then check again.',
  auth: 'Run npm run gateway -- set on the branch computer again, with the username and password the gateway app shows now.',
  refused: 'Check the gateway app is SMSGate with Local Server turned on.',
};
const TEST_LABEL: Record<Test['state'], { text: string; variant: 'success' | 'info' | 'destructive' | 'warning' | 'neutral' }> = {
  Pending: { text: 'Waiting on the phone', variant: 'info' },
  Processed: { text: 'Being sent', variant: 'info' },
  Sent: { text: 'Sent', variant: 'success' },
  Delivered: { text: 'Delivered', variant: 'success' },
  Failed: { text: 'Failed', variant: 'destructive' },
  Unknown: { text: 'Not confirmed yet', variant: 'warning' },
  Missing: { text: 'Never reached the phone', variant: 'destructive' },
};
const FINAL: Test['state'][] = ['Delivered', 'Failed', 'Missing'];

/** Cambodia time with seconds: the steps of one SMS are seconds apart. */
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Phnom_Penh', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function clockLine(seconds: number) {
  const minutes = Math.round(Math.abs(seconds) / 60);
  if (minutes < 1) return 'Matches this computer';
  return `${minutes} min ${seconds > 0 ? 'ahead of' : 'behind'} this computer`;
}

/** The real gateway phone (Phase 8). Its address and password are set with npm run gateway, never on this page. */
export function GatewayCard() {
  const [status, setStatus] = useState<Status | null | 'failed'>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/gateway', { cache: 'no-store' });
      setStatus(res.ok ? await res.json() : 'failed');
    } catch {
      setStatus('failed');
    }
    setChecking(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const s = typeof status === 'object' ? status : null;
  const badge =
    status === null ? null : !s ? null : !s.configured ? (
      <Badge>Not set up</Badge>
    ) : s.problem ? (
      <Badge variant="destructive">{s.problem.kind === 'auth' ? 'Wrong password' : 'Not reachable'}</Badge>
    ) : s.health?.ready ? (
      <Badge variant="success">Connected</Badge>
    ) : (
      <Badge variant="warning">Phone not ready</Badge>
    );

  return (
    <section aria-labelledby="gateway-heading" className="rounded-md border bg-card">
      <div className="px-5 pt-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="gateway-heading" className="text-base font-semibold">
            SMS gateway
          </h2>
          {badge}
        </div>
        <p className="mt-0.5 text-muted-foreground">The Android phone with the branch SIMs sends every SMS. Its address and password are set on the branch computer, not here.</p>
      </div>

      <div className="flex flex-col gap-5 px-5 py-5 sm:px-6">
        <div aria-live="polite">
          {status === null ? (
            <p className="text-sm text-muted-foreground">Checking the gateway phone…</p>
          ) : status === 'failed' ? (
            <p className="text-sm text-destructive">The gateway status could not be loaded. Reload the page.</p>
          ) : !s!.configured ? (
            <div className="text-sm">
              <p>
                Not set up. On the branch computer, run <code className="rounded-sm bg-secondary px-1.5 py-0.5">npm run gateway -- set</code> and type the
                address, username and password from the gateway app (Settings › Local Server).
              </p>
              {s!.problem && <p className="mt-1 text-destructive">{s!.problem}</p>}
            </div>
          ) : s!.problem ? (
            <div className="text-sm">
              <p className="font-medium text-destructive">{s!.problem.message}</p>
              <p className="mt-1">{PROBLEM_HELP[s!.problem.kind]}</p>
              {s!.url && (
                <p className="mt-1 text-muted-foreground">
                  Address: <span className="font-mono break-all">{s!.url}</span>
                </p>
              )}
            </div>
          ) : (
            <Details status={s!} />
          )}
        </div>

        <div>
          <Button type="button" variant="outline" onClick={load} disabled={checking}>
            <RefreshCw aria-hidden className={checking ? 'animate-spin motion-reduce:animate-none' : undefined} />
            {checking ? 'Checking…' : 'Check again'}
          </Button>
        </div>

        {s?.configured && <SimsBox initial={s.sims} />}
        {s?.configured && !s.problem && <TestSms isAdmin={s.isAdmin} initial={s.tests} sims={s.sims.sims} />}
      </div>
    </section>
  );
}

function Details({ status }: { status: Extract<Status, { configured: true }> }) {
  const h = status.health!;
  const failing = Object.values(h.checks).filter((c) => c.status !== 'pass');
  const battery = h.checks['battery:level'];
  const charging = (h.checks['battery:charging']?.observedValue ?? 0) > 0;
  const offset = h.clockOffsetSeconds;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Phone</dt>
      <dd className={h.ready ? undefined : 'text-warning'}>
        {h.ready ? 'Ready to send' : `Not ready: ${failing.map((c) => c.description ?? 'a check fails').join(', ')}`}
      </dd>
      {battery && (
        <>
          <dt className="text-muted-foreground">Battery</dt>
          <dd>
            {battery.observedValue}% · {charging ? 'charging' : 'not charging, keep it on the charger'}
          </dd>
        </>
      )}
      <dt className="text-muted-foreground">Phone clock</dt>
      <dd className={offset !== null && Math.abs(offset) > status.clockLimitSeconds ? 'text-destructive' : undefined}>
        {offset === null ? 'Not reported' : clockLine(offset)}
        {offset !== null && Math.abs(offset) > status.clockLimitSeconds && '. Set the phone to automatic time.'}
      </dd>
      <dt className="text-muted-foreground">Sent messages</dt>
      <dd>
        Deleted on the phone after {status.deleteAfterDays} days{status.deleteAfterSet && ' (set just now)'}
      </dd>
      {status.url && (
        <>
          <dt className="text-muted-foreground">Address</dt>
          <dd className="font-mono break-all">{status.url}</dd>
        </>
      )}
      {h.version && (
        <>
          <dt className="text-muted-foreground">Gateway app</dt>
          <dd>SMSGate {h.version}</dd>
        </>
      )}
    </dl>
  );
}

function TestSms({ isAdmin, initial, sims }: { isAdmin: boolean; initial: Test[]; sims: SimInfo[] }) {
  const [phone, setPhone] = useState('');
  const [sim, setSim] = useState<'auto' | 'both' | number>('auto');
  const [tests, setTests] = useState(initial);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Ask the phone every 2 seconds until each SMS is delivered or failed, for at most 2 minutes after sending.
  useEffect(() => {
    if (!tests.length || tests.every((t) => FINAL.includes(t.state)) || Date.now() - Date.parse(tests[0].sentAt) > 120_000) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/gateway/test-sms', { cache: 'no-store' });
        if (res.ok) setTests((await res.json()).tests);
      } catch {
        // keep the last state; the next render tries again
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [tests]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/gateway/test-sms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, sim }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setTests(body.tests);
      else setError(body.message ?? `The test SMS could not be sent (${res.status}).`);
    } catch {
      setError('The branch app could not be reached. Check the connection, then try again.');
    }
    setSending(false);
  }

  // What "By carrier" would do with the number typed so far, before anything is sent.
  const carrier = carrierOf(phone);
  const slot = carrier ? simByCarrier(sims).get(carrier) : undefined;
  const preview =
    sim !== 'auto' || !carrier ? null : slot ? `${CARRIER_LABEL[carrier]} → SIM ${slot}` : `${CARRIER_LABEL[carrier]}: no ${CARRIER_LABEL[carrier]} SIM is set up, so nothing would be sent`;

  return (
    <div className="border-t pt-5">
      <h3 className="text-sm font-medium">Test SMS</h3>
      {isAdmin ? (
        <form onSubmit={send} className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
          <div className="sm:w-56">
            <label htmlFor="test-phone" className="sr-only">
              Phone number to send the test to
            </label>
            <Input
              id="test-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="Any phone, e.g. 012 345 678"
              aria-invalid={!!error}
              aria-describedby={error ? 'test-error' : 'test-hint'}
            />
          </div>
          {sims.length > 0 && (
            <div>
              <label htmlFor="test-sim" className="sr-only">
                Which SIM sends it
              </label>
              <select
                id="test-sim"
                value={String(sim)}
                onChange={(e) => setSim(e.target.value === 'auto' || e.target.value === 'both' ? e.target.value : Number(e.target.value))}
                className="h-11 w-full rounded-md border border-input bg-card px-3 text-base sm:h-10 sm:w-auto sm:text-sm"
              >
                <option value="auto">By carrier</option>
                {sims.map((s) => (
                  <option key={s.simNumber} value={s.simNumber}>
                    From SIM {s.simNumber}
                  </option>
                ))}
                {sims.length > 1 && <option value="both">From each SIM</option>}
              </select>
            </div>
          )}
          <Button type="submit" variant="outline" disabled={sending || !phone.trim()}>
            <Send aria-hidden />
            {sending ? 'Sending…' : 'Send test SMS'}
          </Button>
        </form>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Only an admin can send a test SMS.</p>
      )}
      {error ? (
        <p id="test-error" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : (
        isAdmin && (
          <p id="test-hint" className="mt-1 text-xs text-muted-foreground">
            {preview ?? 'Sends a short test message, naming the SIM it came from, to the number you type.'}
          </p>
        )
      )}

      {tests.length > 0 && (
        <ul aria-live="polite" className="mt-4 flex flex-col gap-2">
          {tests.map((test) => {
            const label = TEST_LABEL[test.state];
            return (
              <li key={test.id} className="rounded-md bg-secondary px-4 py-3 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge variant={label.variant} className="bg-card">
                    {label.text}
                  </Badge>
                  <span>
                    {test.sim ? `From SIM ${test.sim} to` : 'To'} a number ending {test.toEnding}, sent at {clock(test.sentAt)}
                  </span>
                </p>
                {Object.keys(test.states).length > 0 && (
                  <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                    {(['Pending', 'Processed', 'Sent', 'Delivered', 'Failed'] as const)
                      .filter((k) => test.states[k])
                      .map((k) => (
                        <li key={k}>
                          {k} <span className="tabular-nums">{clock(test.states[k]!)}</span>
                        </li>
                      ))}
                  </ol>
                )}
                {test.error && <p className="mt-1 text-destructive">The phone said: {test.error}</p>}
                {test.state === 'Sent' && <p className="mt-1 text-muted-foreground">Some carriers never confirm delivery. If the phone got it, the test passed.</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The gateway phone's SIMs (Phase 12): scanned from the phone; any staff member confirms which carrier each one is. */
function SimsBox({ initial }: { initial: SimScan }) {
  const [scan, setScan] = useState(initial);
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState('');

  async function rescan() {
    setScanning(true);
    setError('');
    try {
      const res = await fetch('/api/gateway/sims', { cache: 'no-store' });
      if (res.ok) setScan(await res.json());
      else setError(`The SIMs could not be scanned (${res.status}).`);
    } catch {
      setError('The branch app could not be reached. Check the connection, then try again.');
    }
    setScanning(false);
  }

  return (
    <div className="border-t pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">SIMs in the gateway phone</h3>
        <Button type="button" variant="outline" size="sm" onClick={rescan} disabled={scanning}>
          <RefreshCw aria-hidden className={scanning ? 'animate-spin motion-reduce:animate-none' : undefined} />
          {scanning ? 'Scanning…' : 'Scan SIMs'}
        </Button>
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Each SMS goes from the SIM of its customer&apos;s carrier. Customers on a carrier with no confirmed SIM here are listed under Contact by hand on
        Notifications.
      </p>
      <div aria-live="polite">
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        {scan.problem && <p className="mt-2 text-sm text-warning">The phone could not be asked just now: {scan.problem} The SIMs below are from the last scan.</p>}
        {scan.sims.length === 0 ? (
          <p className="mt-3 text-sm">
            No SIMs found. Check that SMSGate is allowed the Phone permission on the gateway phone, then press Scan SIMs.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {scan.sims.map((sim) =>
              editing === sim.simNumber || !sim.carrier ? (
                <ConfirmSim key={sim.simNumber} sim={sim} onSaved={(next) => (setScan({ ...scan, ...next }), setEditing(null))} onCancel={sim.carrier ? () => setEditing(null) : undefined} />
              ) : (
                <li key={sim.simNumber} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm">
                  <span className="font-medium">SIM {sim.simNumber}</span>
                  <Badge variant="success">{CARRIER_LABEL[sim.carrier]}</Badge>
                  <span className="text-muted-foreground">
                    {sim.carrierName ?? 'No carrier name'} · {sim.phoneNumber ? formatPhone(sim.phoneNumber) : 'number not known'}
                  </span>
                  <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing(sim.simNumber)}>
                    Change
                  </Button>
                </li>
              ),
            )}
          </ul>
        )}
        {scan.scannedAt && <p className="mt-2 text-xs text-muted-foreground">Last scanned at {clock(scan.scannedAt)}</p>}
      </div>
    </div>
  );
}

function ConfirmSim({ sim, onSaved, onCancel }: { sim: SimInfo; onSaved: (state: Omit<SimScan, 'problem'>) => void; onCancel?: () => void }) {
  const [carrier, setCarrier] = useState<Carrier | ''>(sim.carrier ?? sim.suggested ?? '');
  const [own, setOwn] = useState(sim.phoneNumber ? formatPhone(sim.phoneNumber) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const id = `sim-${sim.simNumber}`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!carrier) return setError('Choose the carrier of this SIM.');
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/gateway/sims', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ simNumber: sim.simNumber, carrier, ownNumber: own }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) onSaved(body);
      else setError(body.message ?? `Not saved (${res.status}).`);
    } catch {
      setError('The branch app could not be reached. Check the connection, then try again.');
    }
    setSaving(false);
  }

  return (
    <li className="rounded-md border border-warning/50 bg-warning/5 px-3 py-3 text-sm">
      <form onSubmit={save} noValidate>
        <p>
          <span className="font-medium">SIM {sim.simNumber}</span>
          {!sim.carrier && <Badge variant="warning" className="ml-2">Not confirmed</Badge>}
          <span className="ml-2 text-muted-foreground">The phone calls it “{sim.carrierName ?? 'no name'}”.</span>
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <div>
            <label htmlFor={`${id}-carrier`} className="block text-sm font-medium">
              Carrier
            </label>
            <select
              id={`${id}-carrier`}
              value={carrier}
              onChange={(e) => setCarrier(e.target.value as Carrier | '')}
              className="mt-1 h-11 w-full rounded-md border border-input bg-card px-3 text-base sm:h-10 sm:w-52 sm:text-sm"
            >
              <option value="">Choose…</option>
              {CARRIERS.map((c) => (
                <option key={c} value={c}>
                  {CARRIER_LABEL[c]}
                  {c === sim.suggested ? ' (suggested)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-own`} className="block text-sm font-medium">
              This SIM&apos;s number <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input id={`${id}-own`} value={own} onChange={(e) => setOwn(e.target.value)} inputMode="tel" placeholder="e.g. 010 123 456" className="mt-1 sm:w-44" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Confirm'}
            </Button>
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </div>
        {error && <p className="mt-2 text-destructive">{error}</p>}
        <p className="mt-2 text-xs text-muted-foreground">Until it is confirmed, this SIM sends nothing and its carrier&apos;s customers are contacted by hand.</p>
      </form>
    </li>
  );
}
