'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Check = { description?: string; observedValue: number; status: string };
type Test = {
  id: string;
  toEnding: string;
  sentAt: string;
  state: 'Pending' | 'Processed' | 'Sent' | 'Delivered' | 'Failed' | 'Unknown' | 'Missing';
  states: Partial<Record<'Pending' | 'Processed' | 'Sent' | 'Delivered' | 'Failed', string>>;
  error: string | null;
};
type Status = { isAdmin: boolean; test: Test | null } & (
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
        <p className="mt-0.5 text-muted-foreground">The Android phone with the branch SIM sends every SMS. Its address and password are set on the branch computer, not here.</p>
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

        {s?.configured && !s.problem && <TestSms isAdmin={s.isAdmin} initial={s.test} />}
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

function TestSms({ isAdmin, initial }: { isAdmin: boolean; initial: Test | null }) {
  const [phone, setPhone] = useState('');
  const [test, setTest] = useState(initial);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Ask the phone every 2 seconds until the SMS is delivered or failed, for at most 2 minutes after sending.
  useEffect(() => {
    if (!test || FINAL.includes(test.state) || Date.now() - Date.parse(test.sentAt) > 120_000) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/gateway/test-sms', { cache: 'no-store' });
        if (res.ok) setTest((await res.json()).test);
      } catch {
        // keep the last state; the next render tries again
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [test]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/gateway/test-sms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setTest(body.test);
      else setError(body.message ?? `The test SMS could not be sent (${res.status}).`);
    } catch {
      setError('The branch app could not be reached. Check the connection, then try again.');
    }
    setSending(false);
  }

  const label = test && TEST_LABEL[test.state];
  return (
    <div className="border-t pt-5">
      <h3 className="text-sm font-medium">Test SMS</h3>
      {isAdmin ? (
        <form onSubmit={send} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="sm:w-64">
            <label htmlFor="test-phone" className="sr-only">
              Staff phone number
            </label>
            <Input
              id="test-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="Staff phone, e.g. 012 345 678"
              aria-invalid={!!error}
              aria-describedby={error ? 'test-error' : 'test-hint'}
            />
          </div>
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
            Sends “Campus Branch test message” from the branch SIM to a staff number.
          </p>
        )
      )}

      {test && label && (
        <div aria-live="polite" className="mt-4 rounded-md bg-secondary px-4 py-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant={label.variant} className="bg-card">
              {label.text}
            </Badge>
            <span>
              To a number ending {test.toEnding}, sent at {clock(test.sentAt)}
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
          {test.state === 'Sent' && <p className="mt-1 text-muted-foreground">Some carriers never confirm delivery. If the staff phone got it, the test passed.</p>}
        </div>
      )}
    </div>
  );
}
