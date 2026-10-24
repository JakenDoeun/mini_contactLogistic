'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CARRIER_LABEL, CARRIERS, carrierOf, simByCarrier, type Carrier, type SimInfo } from '@/lib/carriers';
import { formatPhone } from '@/lib/parcel-logic';
import { formatDate, type Locale } from '@/lib/i18n';
import { useT, type MessageKey } from '@/lib/i18n-react';

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

const PROBLEM_HELP: Record<string, MessageKey> = {
  unreachable: 'gw.help.unreachable',
  timeout: 'gw.help.timeout',
  auth: 'gw.help.auth',
  refused: 'gw.help.refused',
};
const TEST_LABEL: Record<Test['state'], { text: MessageKey; variant: 'success' | 'info' | 'destructive' | 'warning' | 'neutral' }> = {
  Pending: { text: 'gw.test.pending', variant: 'info' },
  Processed: { text: 'gw.test.processed', variant: 'info' },
  Sent: { text: 'gw.test.sent', variant: 'success' },
  Delivered: { text: 'gw.test.delivered', variant: 'success' },
  Failed: { text: 'gw.test.failed', variant: 'destructive' },
  Unknown: { text: 'gw.test.unknown', variant: 'warning' },
  Missing: { text: 'gw.test.missing', variant: 'destructive' },
};
const FINAL: Test['state'][] = ['Delivered', 'Failed', 'Missing'];

/** Cambodia time with seconds: the steps of one SMS are seconds apart. */
const clock = (iso: string, locale: Locale) =>
  formatDate(new Date(iso), locale, { timeZone: 'Asia/Phnom_Penh', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function clockLine(seconds: number, t: ReturnType<typeof useT>) {
  const minutes = Math.round(Math.abs(seconds) / 60);
  if (minutes < 1) return t('gw.clock.matches');
  return t(seconds > 0 ? 'gw.clock.ahead' : 'gw.clock.behind', { minutes });
}

/** The real gateway phone (Phase 8). Its address and password are set with npm run gateway, never on this page. */
export function GatewayCard() {
  const t = useT();
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
      <Badge>{t('gw.notSetUp')}</Badge>
    ) : s.problem ? (
      <Badge variant="destructive">{s.problem.kind === 'auth' ? t('gw.wrongPassword') : t('gw.unreachable')}</Badge>
    ) : s.health?.ready ? (
      <Badge variant="success">{t('gw.connected')}</Badge>
    ) : (
      <Badge variant="warning">{t('gw.notReady')}</Badge>
    );

  return (
    <section aria-labelledby="gateway-heading" className="rounded-md border bg-card">
      <div className="px-5 pt-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="gateway-heading" className="text-base font-semibold">
            {t('gw.title')}
          </h2>
          {badge}
        </div>
        <p className="mt-0.5 text-muted-foreground">{t('gw.lead')}</p>
      </div>

      <div className="flex flex-col gap-5 px-5 py-5 sm:px-6">
        <div aria-live="polite">
          {status === null ? (
            <p className="text-sm text-muted-foreground">{t('gw.checking')}</p>
          ) : status === 'failed' ? (
            <p className="text-sm text-destructive">{t('gw.loadFailed')}</p>
          ) : !s!.configured ? (
            <div className="text-sm">
              <p>
                {t.rich('gw.setUp', { command: <code className="rounded-sm bg-secondary px-1.5 py-0.5">npm run gateway -- set</code> })}
              </p>
              {s!.problem && <p className="mt-1 text-destructive">{s!.problem}</p>}
            </div>
          ) : s!.problem ? (
            <div className="text-sm">
              <p className="font-medium text-destructive">{s!.problem.message}</p>
              <p className="mt-1">{t(PROBLEM_HELP[s!.problem.kind])}</p>
              {s!.url && (
                <p className="mt-1 text-muted-foreground">
                  {t.rich('gw.address', { url: <span className="font-mono break-all">{s!.url}</span> })}
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
            {checking ? t('common.checking') : t('ready.checkAgain')}
          </Button>
        </div>

        {s?.configured && <SimsBox initial={s.sims} />}
        {s?.configured && !s.problem && <TestSms isAdmin={s.isAdmin} initial={s.tests} sims={s.sims.sims} />}
      </div>
    </section>
  );
}

function Details({ status }: { status: Extract<Status, { configured: true }> }) {
  const t = useT();
  const h = status.health!;
  const failing = Object.values(h.checks).filter((c) => c.status !== 'pass');
  const battery = h.checks['battery:level'];
  const charging = (h.checks['battery:charging']?.observedValue ?? 0) > 0;
  const offset = h.clockOffsetSeconds;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      <dt className="text-muted-foreground">{t('gw.d.phone')}</dt>
      <dd className={h.ready ? undefined : 'text-warning'}>
        {h.ready ? t('gw.d.ready') : t('gw.d.notReady', { checks: failing.map((c) => c.description ?? t('gw.d.checkFails')).join(', ') })}
      </dd>
      {battery && (
        <>
          <dt className="text-muted-foreground">{t('gw.d.battery')}</dt>
          <dd>{t(charging ? 'gw.d.charging' : 'gw.d.notCharging', { level: battery.observedValue })}</dd>
        </>
      )}
      <dt className="text-muted-foreground">{t('gw.d.clock')}</dt>
      <dd className={offset !== null && Math.abs(offset) > status.clockLimitSeconds ? 'text-destructive' : undefined}>
        {offset === null ? t('gw.d.notReported') : clockLine(offset, t)}
        {offset !== null && Math.abs(offset) > status.clockLimitSeconds && t('gw.d.setAuto')}
      </dd>
      <dt className="text-muted-foreground">{t('gw.d.sent')}</dt>
      <dd>
        {t('gw.d.deleted', { count: status.deleteAfterDays })}
        {status.deleteAfterSet && t('gw.d.setNow')}
      </dd>
      {status.url && (
        <>
          <dt className="text-muted-foreground">{t('gw.d.addressLabel')}</dt>
          <dd className="font-mono break-all">{status.url}</dd>
        </>
      )}
      {h.version && (
        <>
          <dt className="text-muted-foreground">{t('gw.d.app')}</dt>
          <dd>SMSGate {h.version}</dd>
        </>
      )}
    </dl>
  );
}

function TestSms({ isAdmin, initial, sims }: { isAdmin: boolean; initial: Test[]; sims: SimInfo[] }) {
  const t = useT();
  const [phone, setPhone] = useState('');
  const [sim, setSim] = useState<'auto' | 'both' | number>('auto');
  const [tests, setTests] = useState(initial);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Ask the phone every 2 seconds until each SMS is delivered or failed, for at most 2 minutes after sending.
  useEffect(() => {
    if (!tests.length || tests.every((x) => FINAL.includes(x.state)) || Date.now() - Date.parse(tests[0].sentAt) > 120_000) return;
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
      else setError(body.message ?? t('gw.t.failedStatus', { status: res.status }));
    } catch {
      setError(t('api.unreachable'));
    }
    setSending(false);
  }

  // What "By carrier" would do with the number typed so far, before anything is sent.
  const carrier = carrierOf(phone);
  const slot = carrier ? simByCarrier(sims).get(carrier) : undefined;
  const preview =
    sim !== 'auto' || !carrier
      ? null
      : slot
        ? t('gw.t.preview', { carrier: CARRIER_LABEL[carrier], sim: slot })
        : t('gw.t.noSim', { carrier: CARRIER_LABEL[carrier] });

  return (
    <div className="border-t pt-5">
      <h3 className="text-sm font-medium">{t('gw.t.title')}</h3>
      {isAdmin ? (
        <form onSubmit={send} className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
          <div className="sm:w-56">
            <label htmlFor="test-phone" className="sr-only">
              {t('gw.t.phone')}
            </label>
            <Input
              id="test-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder={t('gw.t.placeholder')}
              aria-invalid={!!error}
              aria-describedby={error ? 'test-error' : 'test-hint'}
            />
          </div>
          {sims.length > 0 && (
            <div>
              <label htmlFor="test-sim" className="sr-only">
                {t('gw.t.which')}
              </label>
              <select
                id="test-sim"
                value={String(sim)}
                onChange={(e) => setSim(e.target.value === 'auto' || e.target.value === 'both' ? e.target.value : Number(e.target.value))}
                className="h-11 w-full rounded-md border border-input bg-card px-3 text-base sm:h-10 sm:w-auto sm:text-sm"
              >
                <option value="auto">{t('gw.t.byCarrier')}</option>
                {sims.map((s) => (
                  <option key={s.simNumber} value={s.simNumber}>
                    {t('gw.t.fromSim', { sim: s.simNumber })}
                  </option>
                ))}
                {sims.length > 1 && <option value="both">{t('gw.t.fromEach')}</option>}
              </select>
            </div>
          )}
          <Button type="submit" variant="outline" disabled={sending || !phone.trim()}>
            <Send aria-hidden />
            {sending ? t('gw.t.sending') : t('gw.t.send')}
          </Button>
        </form>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{t('gw.t.adminOnly')}</p>
      )}
      {error ? (
        <p id="test-error" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : (
        isAdmin && (
          <p id="test-hint" className="mt-1 text-xs text-muted-foreground">
            {preview ?? t('gw.t.hint')}
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
                    {t(label.text)}
                  </Badge>
                  <span>
                    {test.sim
                      ? t('gw.t.fromSimTo', { sim: test.sim, ending: test.toEnding, time: clock(test.sentAt, t.locale) })
                      : t('gw.t.to', { ending: test.toEnding, time: clock(test.sentAt, t.locale) })}
                  </span>
                </p>
                {Object.keys(test.states).length > 0 && (
                  <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                    {(['Pending', 'Processed', 'Sent', 'Delivered', 'Failed'] as const)
                      .filter((k) => test.states[k])
                      .map((k) => (
                        <li key={k}>
                          {t(`gw.step.${k}`)} <span className="tabular-nums">{clock(test.states[k]!, t.locale)}</span>
                        </li>
                      ))}
                  </ol>
                )}
                {test.error && <p className="mt-1 text-destructive">{t('gw.t.phoneSaid', { error: test.error })}</p>}
                {test.state === 'Sent' && <p className="mt-1 text-muted-foreground">{t('gw.t.someCarriers')}</p>}
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
  const t = useT();
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
      else setError(t('gw.s.failed', { status: res.status }));
    } catch {
      setError(t('api.unreachable'));
    }
    setScanning(false);
  }

  return (
    <div className="border-t pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('gw.s.title')}</h3>
        <Button type="button" variant="outline" size="sm" onClick={rescan} disabled={scanning}>
          <RefreshCw aria-hidden className={scanning ? 'animate-spin motion-reduce:animate-none' : undefined} />
          {scanning ? t('gw.s.scanning') : t('gw.s.scan')}
        </Button>
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {t('gw.s.lead')}
      </p>
      <div aria-live="polite">
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        {scan.problem && <p className="mt-2 text-sm text-warning">{t('gw.s.problem', { problem: scan.problem })}</p>}
        {scan.sims.length === 0 ? (
          <p className="mt-3 text-sm">
            {t('gw.s.none')}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {scan.sims.map((sim) =>
              editing === sim.simNumber || !sim.carrier ? (
                <ConfirmSim key={sim.simNumber} sim={sim} onSaved={(next) => (setScan({ ...scan, ...next }), setEditing(null))} onCancel={sim.carrier ? () => setEditing(null) : undefined} />
              ) : (
                <li key={sim.simNumber} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm">
                  <span className="font-medium">{t('gw.s.sim', { sim: sim.simNumber })}</span>
                  <Badge variant="success">{CARRIER_LABEL[sim.carrier]}</Badge>
                  <span className="text-muted-foreground">
                    {sim.carrierName ?? t('gw.s.noName')} · {sim.phoneNumber ? formatPhone(sim.phoneNumber) : t('gw.s.numberUnknown')}
                  </span>
                  <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing(sim.simNumber)}>
                    {t('gw.s.change')}
                  </Button>
                </li>
              ),
            )}
          </ul>
        )}
        {scan.scannedAt && <p className="mt-2 text-xs text-muted-foreground">{t('gw.s.lastScan', { time: clock(scan.scannedAt, t.locale) })}</p>}
      </div>
    </div>
  );
}

function ConfirmSim({ sim, onSaved, onCancel }: { sim: SimInfo; onSaved: (state: Omit<SimScan, 'problem'>) => void; onCancel?: () => void }) {
  const t = useT();
  const [carrier, setCarrier] = useState<Carrier | ''>(sim.carrier ?? sim.suggested ?? '');
  const [own, setOwn] = useState(sim.phoneNumber ? formatPhone(sim.phoneNumber) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const id = `sim-${sim.simNumber}`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!carrier) return setError(t('gw.c.choose'));
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
      else setError(body.message ?? t('gw.c.notSaved', { status: res.status }));
    } catch {
      setError(t('api.unreachable'));
    }
    setSaving(false);
  }

  return (
    <li className="rounded-md border border-warning/50 bg-warning/5 px-3 py-3 text-sm">
      <form onSubmit={save} noValidate>
        <p>
          <span className="font-medium">{t('gw.s.sim', { sim: sim.simNumber })}</span>
          {!sim.carrier && <Badge variant="warning" className="ml-2">{t('gw.c.notConfirmed')}</Badge>}
          <span className="ml-2 text-muted-foreground">{t('gw.c.phoneCalls', { name: sim.carrierName ?? t('gw.c.noName') })}</span>
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <div>
            <label htmlFor={`${id}-carrier`} className="block text-sm font-medium">
              {t('gw.c.carrier')}
            </label>
            <select
              id={`${id}-carrier`}
              value={carrier}
              onChange={(e) => setCarrier(e.target.value as Carrier | '')}
              className="mt-1 h-11 w-full rounded-md border border-input bg-card px-3 text-base sm:h-10 sm:w-52 sm:text-sm"
            >
              <option value="">{t('gw.c.chooseOption')}</option>
              {CARRIERS.map((c) => (
                <option key={c} value={c}>
                  {CARRIER_LABEL[c]}
                  {c === sim.suggested ? t('gw.c.suggested') : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-own`} className="block text-sm font-medium">
              {t.rich('gw.c.own', { optional: <span className="font-normal text-muted-foreground">{t('gw.c.optional')}</span> })}
            </label>
            <Input id={`${id}-own`} value={own} onChange={(e) => setOwn(e.target.value)} inputMode="tel" placeholder={t('gw.c.ownPlaceholder')} className="mt-1 sm:w-44" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? t('common.saving') : t('gw.c.confirm')}
            </Button>
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel}>
                {t('common.cancel')}
              </Button>
            )}
          </div>
        </div>
        {error && <p className="mt-2 text-destructive">{error}</p>}
        <p className="mt-2 text-xs text-muted-foreground">{t('gw.c.until')}</p>
      </form>
    </li>
  );
}
