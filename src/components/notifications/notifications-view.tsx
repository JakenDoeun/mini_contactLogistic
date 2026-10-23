'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronRight, CircleCheck, MessageSquare, Pause, Phone, PhoneOff, Play, RotateCcw, Search, Send, Smartphone, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DirectContact } from '@/components/parcels/contact-panel';
import { ParcelDetail } from '@/components/parcels/parcel-detail';
import { SmsBadge } from '@/components/parcels/parcel-status';
import { batchLabel } from '@/components/parcels/phone-group';
import { DateFilter } from '@/components/shared/date-filter';
import { CARRIER_LABEL, carrierCounts, splitBySim, type Carrier, type SimInfo } from '@/lib/carriers';
import { planNotify, workList, type NotifyItem } from '@/lib/dashboard-logic';
import { ANY_DATE, inDateRange, isAnyDate, rangePhrase, type DateRange } from '@/lib/date-range';
import {
  arrivalDay,
  composeMessage,
  reachedByStaff,
  formatPhone,
  normalizePhone,
  smsInFlight,
  smsScope,
  telegramLink,
  type Channel,
  type ContactEvent,
} from '@/lib/parcel-logic';
import { controlBatch, dismissBatch, queueBatch, queueSms, reloadParcels, releaseRestoreHold, useParcelData, type ParcelData, type SmsBatch } from '@/lib/parcel-service';
import { currentGap, currentTemplates, useSettings } from '@/lib/settings-service';
import { playAttention, playDone } from '@/lib/sounds';
import { cn, formatDateTime, formatTime } from '@/lib/utils';

type ChannelFilter = 'all' | 'sms' | 'call' | 'telegram' | 'other';
const CHANNEL_FILTERS: { key: ChannelFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sms', label: 'SMS' },
  { key: 'call', label: 'Calls' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'other', label: 'Other phone' },
];

const CHANNEL: Record<Channel, { label: string; icon: typeof Send }> = {
  sms: { label: 'SMS', icon: Send },
  call: { label: 'Call', icon: Phone },
  telegram: { label: 'Telegram', icon: MessageSquare },
  other: { label: 'SMS from another phone', icon: Smartphone },
};
const OUTCOME = { answered: 'Reached customer', 'no-answer': 'No answer', messaged: 'Sent on Telegram' };

const waiting = (e: ContactEvent) => e.smsStatus === 'queued' || e.smsStatus === 'sending';
const PAGE = 10;
const READY_SHOWN = 6;

type Tab = 'today' | 'by-hand' | 'history';
const TABS: { key: Tab; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'by-hand', label: 'Contact by hand' },
  { key: 'history', label: 'History' },
];

export function NotificationsView({ initialFilter, initialTab = 'today' }: { initialFilter?: string; initialTab?: Tab }) {
  const data = useParcelData();
  const templates = useSettings()?.templates;
  const [retrying, setRetrying] = useState<ContactEvent | null>(null);
  /** A parcel code; its detail, with the contact panel and phone field, opens in a drawer. */
  const [contacting, setContacting] = useState<string | null>(null);
  /** The arrival day whose batch is being confirmed: today, or one earlier day under review. */
  const [confirmDay, setConfirmDay] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const choose = (next: Tab) => {
    setTab(next);
    // Kept in the address, so a reload or the back button returns to the same tab.
    const url = new URL(window.location.href);
    if (next === 'today') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

  const events = data ? [...data.events].sort((a, b) => b.at.localeCompare(a.at)) : null;
  const work = data ? workList(data.parcels, data.events) : null;
  const plan = data ? planNotify(data.parcels, data.events, new Date(), templates) : null;
  const nameOf = (code: string) => data?.parcels.find((p) => p.code === code)?.recipient ?? '';
  const contactParcel = data?.parcels.find((p) => p.code === contacting);
  const running = !!data?.batch && (data.batch.status === 'running' || data.batch.status === 'paused');
  const sims = data?.gateway.sims ?? [];
  const byHand = byHandList(plan, data, sims);

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-muted-foreground">Fix what went wrong, send today&apos;s messages in one go, and look back at what was sent.</p>
        </div>
      </div>

      {data?.restoreHold && <RestoreCheck data={data} copyAt={data.restoreHold.copyAt} />}

      <div
        role="tablist"
        aria-label="Notifications"
        className="mt-6 flex gap-1 border-b"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          const i = TABS.findIndex((t) => t.key === tab);
          const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].key;
          choose(next);
          document.getElementById(`tab-${next}`)?.focus();
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`tab-${t.key}`}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => choose(t.key)}
            className={cn(
              '-mb-px min-h-11 border-b-2 px-4 text-sm font-medium transition-colors motion-reduce:transition-none',
              tab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {t.key === 'by-hand' && byHand.length > 0 && (
              <span className="ml-2 rounded-full bg-warning-tint px-2 py-0.5 font-mono text-xs font-medium text-warning">
                <span className="sr-only">, </span>
                {byHand.length}
                <span className="sr-only"> waiting</span>
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Urgency sets the size: attention leads, the live queue follows, ready-to-send supports from the side. */}
      <div
        id="panel-today"
        role="tabpanel"
        aria-labelledby="tab-today"
        hidden={tab !== 'today'}
        className={tab === 'today' ? 'mt-7 grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_19rem]' : 'hidden'}
      >
        <div className="flex min-w-0 flex-col gap-8">
          <Attention work={work} events={events} nameOf={nameOf} onRetry={setRetrying} onOpen={setContacting} />
          <SendingQueue data={data} nameOf={nameOf} running={running} />
        </div>
        <Ready
          plan={plan}
          running={running}
          hold={!!data?.restoreHold}
          noGateway={data ? !data.gateway.setUp : false}
          sims={sims}
          byHand={byHand.length}
          onNotify={setConfirmDay}
          onByHand={() => choose('by-hand')}
        />
      </div>

      <div id="panel-by-hand" role="tabpanel" aria-labelledby="tab-by-hand" hidden={tab !== 'by-hand'} className="mt-7">
        <ContactByHand list={byHand} data={data} />
      </div>

      <div id="panel-history" role="tabpanel" aria-labelledby="tab-history" hidden={tab !== 'history'}>
        <History events={events} data={data} nameOf={nameOf} initialChannel={initialFilter} />
      </div>

      <RunAlerts data={data} />
      <RetrySheet event={retrying} data={data} onClose={() => setRetrying(null)} />
      <ConfirmNotify day={confirmDay} data={data} templates={templates} onClose={() => setConfirmDay(null)} />

      <Sheet open={!!contactParcel} onOpenChange={(o) => !o && setContacting(null)}>
        <SheetContent className="max-w-2xl bg-background" aria-describedby={undefined}>
          {contactParcel && data && (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-14 pb-6 sm:px-6">
              <ParcelDetail parcel={contactParcel} data={data} Title={SheetTitle} onSelect={setContacting} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

const TONE = {
  destructive: 'bg-destructive-tint text-destructive',
  neutral: 'bg-secondary text-foreground',
};

function Heading({ id, title, hint, count, tone = 'neutral', large }: { id: string; title: string; hint?: string; count?: number; tone?: keyof typeof TONE; large?: boolean }) {
  return (
    <div>
      <h2 id={id} className={cn('flex items-center gap-2 font-semibold tracking-tight', large ? 'text-xl' : 'text-lg')}>
        {title}
        {count !== undefined && <span className={cn('rounded-full px-2 py-0.5 font-mono text-xs font-medium', TONE[tone])}>{count}</span>}
      </h2>
      {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Failed or uncertain SMS and parcels nobody can message: what goes wrong if nobody acts. */
function Attention({
  work,
  events,
  nameOf,
  onRetry,
  onOpen,
}: {
  work: ReturnType<typeof workList> | null;
  events: ContactEvent[] | null;
  nameOf: (code: string) => string;
  onRetry: (e: ContactEvent) => void;
  onOpen: (code: string) => void;
}) {
  const total = work ? work.retry.length + work.noPhone.length : undefined;
  return (
    <section aria-labelledby="attention-heading" className="rounded-lg bg-card px-5 py-6 sm:px-7">
      <Heading
        id="attention-heading"
        title="Needs your attention"
        count={total}
        tone={total ? 'destructive' : 'neutral'}
        hint="Messages that failed or can't be confirmed, parcels with no number, and customers to chase."
        large
      />
      {!work || !events ? (
        <div className="mt-5 space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : total === 0 ? (
        <div className="mt-5 flex items-start gap-3 rounded-md bg-success-tint/60 px-4 py-4">
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div>
            <p className="font-medium">All clear</p>
            <p className="text-sm text-muted-foreground">No failed or uncertain messages, and every parcel has a number.</p>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-6">
          {work.retry.length > 0 && (
            <AttentionGroup label="SMS failed or unconfirmed">
              {work.retry.map((e) => (
                <AttentionItem
                  key={e.id}
                  tone={e.smsStatus === 'failed' ? 'destructive' : 'warning'}
                  title={nameOf(e.parcelCodes[0])}
                  phone={e.phone}
                  line={`${smsScope(e.parcelCodes.length)} · ${e.result ?? ''}`}
                  codes={e.parcelCodes}
                  status={<SmsBadge status={e.smsStatus!} />}
                >
                  {/* An unconfirmed SMS may have arrived, so its retry is the quieter button. */}
                  <Button
                    size="sm"
                    variant={e.smsStatus === 'failed' ? 'default' : 'outline'}
                    onClick={() => onRetry(e)}
                    aria-label={`Retry SMS to ${formatPhone(e.phone)}`}
                  >
                    <RotateCcw aria-hidden />
                    Retry
                  </Button>
                  <ReachLinks phone={e.phone} />
                </AttentionItem>
              ))}
            </AttentionGroup>
          )}
          {work.noPhone.length > 0 && (
            <AttentionGroup label="No phone number, left out of SMS">
              {work.noPhone.map((p) => (
                <AttentionItem
                  key={p.code}
                  tone="warning"
                  title={p.recipient}
                  line={`Imported ${formatDateTime(p.importedAt)} from ${p.sourceFile}`}
                  codes={[p.code]}
                  status={
                    <span className="inline-flex items-center gap-1 text-sm text-warning">
                      <PhoneOff className="size-3.5" aria-hidden />
                      {p.phone.trim() ? 'Invalid number' : 'No number'}
                    </span>
                  }
                >
                  <Button size="sm" variant="outline" onClick={() => onOpen(p.code)}>
                    Add phone
                  </Button>
                </AttentionItem>
              ))}
            </AttentionGroup>
          )}
        </div>
      )}
    </section>
  );
}

const AttentionGroup = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</h3>
    <ul className="mt-1 divide-y">{children}</ul>
  </div>
);

function AttentionItem({
  tone,
  title,
  phone,
  line,
  codes,
  status,
  children,
}: {
  tone: 'destructive' | 'warning';
  title: string;
  phone?: string;
  line: string;
  codes: string[];
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="relative flex flex-wrap items-center gap-x-5 gap-y-3 py-4 pl-4">
      {/* The status colour carries urgency on a thin bar, so the row itself stays calm. */}
      <span aria-hidden className={cn('absolute inset-y-4 left-0 w-1 rounded-full', tone === 'destructive' ? 'bg-destructive' : 'bg-warning')} />
      <div className="min-w-0 flex-1 basis-64">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{title}</span>
          {phone && <span className="font-mono text-sm text-muted-foreground">{formatPhone(phone)}</span>}
        </p>
        <p className="mt-0.5 text-sm">{line}</p>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{codes.join(', ')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {status}
        {children}
      </div>
    </li>
  );
}

const ReachLinks = ({ phone }: { phone: string }) => (
  <>
    <Button asChild size="sm" variant="ghost">
      <a href={`tel:${phone}`} aria-label={`Call ${formatPhone(phone)}`}>
        <Phone aria-hidden />
        Call
      </a>
    </Button>
    <Button asChild size="sm" variant="ghost">
      <a href={telegramLink(phone)} target="_blank" rel="noreferrer" aria-label={`Open Telegram for ${formatPhone(phone)}`}>
        <MessageSquare aria-hidden />
        Telegram
      </a>
    </Button>
  </>
);

/** The SMS gateway queue: what is waiting, what is being handed over, and how the latest run is going. */
function SendingQueue({ data, nameOf, running }: { data: ParcelData | null; nameOf: (code: string) => string; running: boolean }) {
  if (!data) return null;
  const inFlight = data.events.filter(waiting).sort((a, b) => a.at.localeCompare(b.at));
  const batch = data.batch ? data.events.filter((e) => data.batch!.eventIds.includes(e.id)) : [];
  const tally = (s: string) => batch.filter((e) => e.smsStatus === s).length;
  const done = batch.length - batch.filter(waiting).length;
  // Queued messages only go out through the phone; say so when it is missing or not answering.
  const stuck = inFlight.some((e) => e.smsStatus === 'queued') && (!data.gateway.setUp || !!data.gateway.awaySince);
  // Phase 12: SMS waiting for a SIM that is not in the phone, and the SIM whose failures paused the run.
  const missing = data.gateway.simMissing.map((sim) => ({ sim, count: inFlight.filter((e) => e.smsStatus === 'queued' && e.sim === sim).length })).filter((m) => m.count);
  const perSim = [...new Set(batch.map((e) => e.sim).filter((n): n is number => !!n))].sort().map((sim) => {
    const mine = batch.filter((e) => e.sim === sim);
    return { sim, done: mine.length - mine.filter(waiting).length, total: mine.length };
  });

  if (!inFlight.length && !batch.length) {
    return (
      <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
        <Send className="size-4" aria-hidden />
        Sending queue is empty. Start one with Notify today&apos;s customers.
      </p>
    );
  }
  return (
    <section aria-labelledby="queue-heading" className="rounded-lg bg-accent/70 px-5 py-5 sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Heading
          id="queue-heading"
          title="Sending queue"
          hint={`Handed to the gateway phone one at a time, ${gapSeconds()} apart so the SIM is not flagged. Accepted messages move to History; failed or unconfirmed ones move to Needs your attention.`}
        />
        {running && data.batch && <BatchControls batch={data.batch} />}
        {batch.length > 0 && !running && (
          <Button size="sm" variant="ghost" onClick={dismissBatch}>
            Dismiss summary
          </Button>
        )}
      </div>

      {batch.length > 0 && (
        <div className="mt-4">
          <p aria-live="polite" className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
            <span className="font-medium">
              {data.batch?.status === 'paused'
                ? `Paused after ${done} of ${batch.length}`
                : running && stuck
                  ? `Waiting for the gateway phone: ${done} of ${batch.length} handed over`
                  : running
                    ? `Sending ${Math.min(done + 1, batch.length)} of ${batch.length}…`
                    : data.batch?.status === 'stopped'
                      ? `Stopped: ${batch.length - tally('not-sent')} of ${batch.length} handed over`
                      : `Finished: ${batch.length} SMS`}
            </span>
            <span className="text-muted-foreground">
              {tally('sent') + tally('delivered')} sent · {tally('failed')} failed · {tally('unconfirmed')} unconfirmed
              {running && ` · ${batch.length - done} to go`}
              {running && !stuck && data.batch?.status === 'running' && ` · about ${gapMinutes(batch.length - done)} left`}
            </span>
          </p>
          <div
            role="progressbar"
            aria-label="Sending progress"
            aria-valuemin={0}
            aria-valuemax={batch.length}
            aria-valuenow={done}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-card"
          >
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(done / batch.length) * 100}%` }} />
          </div>
          {perSim.length > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">{perSim.map((p) => `SIM ${p.sim}: ${p.done} of ${p.total}`).join(' · ')}</p>
          )}
        </div>
      )}

      {data.gateway.simPause !== null && data.batch?.status === 'paused' && (
        <p role="status" className="mt-4 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
          Paused: SIM {data.gateway.simPause} failed twice in a row. Check the gateway phone (a call on that SIM, no credit or no signal), then press Resume.
          The failed SMS are under Needs your attention.
        </p>
      )}
      {missing.map((m) => (
        <MissingSim key={m.sim} sim={m.sim} count={m.count} />
      ))}

      {stuck && (
        <p role="status" className="mt-4 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
          {!data.gateway.setUp
            ? 'No gateway phone is set up, so nothing is being sent. The messages wait here. The administrator sets the phone up on the branch computer; see SMS gateway in Settings.'
            : `The gateway phone has not answered since ${formatTime(data.gateway.awaySince!)}, so nothing is being sent. Check that it is switched on, the SMS Gateway app is running and it is on the network. The messages wait and go out when it answers.`}
        </p>
      )}

      {inFlight.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {inFlight.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-card px-3 py-2.5">
              <span className="min-w-0 flex-1 basis-56">
                <span className="font-medium">{nameOf(e.parcelCodes[0])}</span> <span className="font-mono text-sm text-muted-foreground">{formatPhone(e.phone)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {smsScope(e.parcelCodes.length)} · <span className="font-mono">{e.parcelCodes.join(', ')}</span>
                </span>
              </span>
              <SmsBadge status={e.smsStatus!} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** SMS waiting for a SIM that is not in the gateway phone: put it back, or contact those customers by hand instead. */
function MissingSim({ sim, count }: { sim: number; count: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function release() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/gateway/sims', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ release: sim }) });
      if (!res.ok) throw new Error(`Not changed (${res.status}).`);
      await reloadParcels();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <div role="status" className="mt-4 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
      <p>
        SIM {sim} is not in the gateway phone, so {count === 1 ? '1 SMS for it is' : `${count} SMS for it are`} waiting. Put the SIM back, or contact
        {count === 1 ? ' this customer' : ' these customers'} by hand instead.
      </p>
      <Button size="sm" variant="outline" className="mt-2 bg-card" disabled={busy} onClick={release}>
        {busy ? 'Moving…' : 'Contact them by hand instead'}
      </Button>
      {error && <p className="mt-1 text-destructive">{error}</p>}
    </div>
  );
}

/**
 * After a restore, messages sent after the copy are missing here, so those customers look Not messaged. Staff check the
 * gateway phone, tick each customer it shows an SMS for (saved as Sent, so nobody is messaged twice), and confirm.
 */
function RestoreCheck({ data, copyAt }: { data: ParcelData; copyAt: string }) {
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const copyDay = arrivalDay(copyAt);
  const lines = workList(data.parcels, data.events).toMessage.filter((g) => g.day >= copyDay);
  const keyOf = (g: (typeof lines)[number]) => `${g.day}|${g.phone}`;
  async function resume() {
    setSaving(true);
    setError('');
    try {
      await releaseRestoreHold(lines.filter((g) => seen.has(keyOf(g))).map((g) => ({ phone: g.phone, codes: g.codes })));
    } catch (e) {
      setError(`Not saved. ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section aria-labelledby="restore-heading" className="mt-7 rounded-lg border border-warning/40 bg-warning-tint px-5 py-5 sm:px-7">
      <h2 id="restore-heading" className="font-semibold text-warning">
        SMS sending is on hold after a restore
      </h2>
      <p className="mt-1 text-sm">
        The data was restored from a copy taken {formatDateTime(copyAt)}. Messages the gateway phone sent after that are not in this app, so those
        customers look not messaged yet. Nothing is sent until you check.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
        <li>On the gateway phone, open the Messages app and look at what was sent since {formatDateTime(copyAt)}.</li>
        <li>Tick every customer below that the phone shows a message for. They are saved as Sent and not messaged again.</li>
        <li>Confirm, and sending resumes.</li>
      </ol>
      {lines.length > 0 ? (
        <ul className="mt-4 max-h-80 divide-y overflow-y-auto rounded-md border bg-card">
          {lines.map((g) => (
            <li key={keyOf(g)}>
              <label className="flex min-h-11 items-start gap-3 px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={seen.has(keyOf(g))}
                  onChange={(e) => {
                    const next = new Set(seen);
                    if (e.target.checked) next.add(keyOf(g));
                    else next.delete(keyOf(g));
                    setSeen(next);
                  }}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0">
                  <span className="font-medium">{g.recipient}</span> <span className="font-mono text-xs text-muted-foreground">{formatPhone(g.phone)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    Arrived {batchLabel(g.day)} · <span className="font-mono">{g.codes.join(', ')}</span>
                  </span>
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{seen.has(keyOf(g)) ? 'Got an SMS' : ''}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No customer since the copy is waiting for a message.</p>
      )}
      <label className="mt-4 flex min-h-11 items-start gap-2 text-sm font-medium sm:min-h-8">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
        I checked the gateway phone&apos;s sent messages since {formatDateTime(copyAt)}.
      </label>
      <Button className="mt-3" disabled={!checked || saving} onClick={resume}>
        {saving ? 'Saving…' : seen.size ? `Save ${seen.size} as sent and resume sending` : 'Resume sending'}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

/** Pause holds the rest of the run after the message being handed over; Stop cancels the ones still waiting. */
function BatchControls({ batch }: { batch: SmsBatch }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const paused = batch.status === 'paused';
  async function act(action: 'pause' | 'resume' | 'stop') {
    setBusy(true);
    setError('');
    try {
      await controlBatch(batch.id, action);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" className="bg-card" disabled={busy} onClick={() => act(paused ? 'resume' : 'pause')}>
        {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
        {paused ? 'Resume' : 'Pause'}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => act('stop')}>
        <Square aria-hidden />
        Stop
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Today's phone lines with parcels nobody has told the customer about, and the one button that sends them all. */
function Ready({
  plan,
  running,
  hold,
  noGateway,
  sims,
  byHand,
  onNotify,
  onByHand,
}: {
  plan: ReturnType<typeof planNotify> | null;
  running: boolean;
  hold: boolean;
  noGateway: boolean;
  sims: SimInfo[];
  /** Customers waiting on the Contact by hand tab. */
  byHand: number;
  onNotify: (day: string) => void;
  onByHand: () => void;
}) {
  const parcels = plan?.today.reduce((n, i) => n + i.codes.length, 0) ?? 0;
  const split = plan ? splitBySim(plan.today, sims) : null;
  const noSim = !noGateway && !sims.some((s) => s.carrier);
  return (
    <aside aria-labelledby="ready-heading" className="rounded-lg bg-secondary/70 px-5 py-5">
      <h2 id="ready-heading" className="font-semibold">
        Ready to notify
      </h2>
      {!plan ? (
        <Skeleton className="mt-3 h-24 w-full" />
      ) : (
        <>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {plan.today.length} <span className="text-base font-normal text-muted-foreground">{plan.today.length === 1 ? 'customer' : 'customers'}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            {parcels} {parcels === 1 ? 'parcel' : 'parcels'} from today, one SMS per phone number
          </p>
          {split && plan.today.length > 0 && !noGateway && (
            <>
              <p className="text-sm text-muted-foreground">
                {split.auto.length} by SMS · {split.byHand.length} to contact by hand
              </p>
              <CarrierTable items={plan.today} sims={sims} className="mt-3" compact />
            </>
          )}
          {byHand > 0 && (
            <button type="button" onClick={onByHand} className="mt-1 min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline sm:min-h-8">
              Open Contact by hand ({byHand})
            </button>
          )}
          <Button className="mt-4 w-full" onClick={() => onNotify(arrivalDay(new Date().toISOString()))} disabled={running || hold || noGateway || plan.today.length === 0}>
            <Send aria-hidden />
            Notify today&apos;s customers
          </Button>
          {running && <p className="mt-2 text-xs text-muted-foreground">A run is in progress. Start the next one when it finishes.</p>}
          {hold && <p className="mt-2 text-xs text-warning">Sending is on hold after a restore. Check the gateway phone first.</p>}
          {noSim && (
            <p className="mt-2 text-xs text-warning">
              No SIM in the gateway phone is confirmed yet, so every customer is to be contacted by hand. Confirm the SIMs in{' '}
              <Link href="/settings" className="font-medium underline underline-offset-4">
                SMS gateway in Settings
              </Link>
              .
            </p>
          )}
          {noGateway && (
            <p className="mt-2 text-xs text-warning">
              No gateway phone is set up yet, so nothing can be sent. The administrator sets it up on the branch computer; see{' '}
              <Link href="/settings" className="font-medium underline underline-offset-4">
                SMS gateway in Settings
              </Link>
              .
            </p>
          )}

          {plan.today.length === 0 ? (
            <div className="mt-4 text-sm">
              <p className="font-medium">Everyone from today is notified</p>
              <Link
                href="/import-arrivals"
                className="mt-1 inline-flex min-h-11 items-center gap-1 font-medium text-primary underline-offset-4 hover:underline sm:min-h-8"
              >
                Import arrivals
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-border/70 text-sm">
              {plan.today.slice(0, READY_SHOWN).map((i) => (
                <li key={`${i.day}|${i.phone}`} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">
                    {i.recipient} <span className="font-mono text-xs text-muted-foreground">{formatPhone(i.phone)}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{i.codes.length === 1 ? '1 parcel' : `${i.codes.length} parcels`}</span>
                </li>
              ))}
              {plan.today.length > READY_SHOWN && <li className="py-2 text-xs text-muted-foreground">and {plan.today.length - READY_SHOWN} more</li>}
            </ul>
          )}
          {plan.noPhoneToday.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              <li>
                {plan.noPhoneToday.length === 1 ? "1 of today's parcels has" : `${plan.noPhoneToday.length} of today's parcels have`} no phone number and{' '}
                {plan.noPhoneToday.length === 1 ? 'is' : 'are'} skipped.
              </li>
            </ul>
          )}
          {plan.older.length > 0 && (
            <div className="mt-5 border-t pt-4">
              <h3 className="text-sm font-medium">Earlier arrivals not notified</h3>
              <p className="text-xs text-muted-foreground">Sent one day at a time after you review them, never with today&apos;s messages.</p>
              <ul className="mt-2 divide-y divide-border/70 text-sm">
                {byDay(plan.older).map(([day, list]) => (
                  <li key={day} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      Arrived {batchLabel(day)}{' '}
                      <span className="text-xs text-muted-foreground">
                        · {list.length} {list.length === 1 ? 'customer' : 'customers'}
                      </span>
                    </span>
                    <Button size="sm" variant="outline" className="shrink-0 bg-card" disabled={running || hold || noGateway} onClick={() => onNotify(day)}>
                      Review
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

/** Customers per carrier and how each group is told: by SMS from its SIM, or by hand (Phase 12). */
function CarrierTable({ items, sims, className, compact }: { items: { phone: string }[]; sims: SimInfo[]; className?: string; compact?: boolean }) {
  const rows = carrierCounts(items, sims);
  if (!rows.length) return null;
  return (
    <table className={cn('w-full', compact ? 'text-xs' : 'text-sm', className)}>
      <caption className="sr-only">Customers by carrier</caption>
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th scope="col" className="py-1.5 font-medium">
            Carrier
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Customers
          </th>
          <th scope="col" className={cn('py-1.5 font-medium', compact ? 'pl-3' : 'pl-4')}>
            {compact ? 'How' : 'How they are told'}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.carrier ?? 'unknown'} className="border-b last:border-0">
            <th scope="row" className="py-1.5 text-left font-normal">
              {r.carrier ? CARRIER_LABEL[r.carrier] : 'Unknown prefix'}
            </th>
            <td className="py-1.5 text-right font-mono">{r.count}</td>
            <td className={cn('py-1.5', compact ? 'pl-3' : 'pl-4')}>
              {r.sim ? `SMS from SIM ${r.sim}` : <span className="text-warning">{compact ? 'By hand' : 'Contact by hand'}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** How long this many gaps between messages take; the gap is random, so it is a range. */
function gapMinutes(gaps: number) {
  const { from: lo, to: hi } = currentGap();
  const [a, b] = [Math.max(1, Math.round((gaps * lo) / 60)), Math.max(1, Math.ceil((gaps * hi) / 60))];
  return a === b ? `${a} ${a === 1 ? 'minute' : 'minutes'}` : `${a}–${b} minutes`;
}

/** The gap between two SMS as staff read it: "25–80 seconds", or "15 seconds" when the admin set one fixed gap. */
function gapSeconds() {
  const { from, to } = currentGap();
  return from === to ? `${from} seconds` : `${from}–${to} seconds`;
}

/** How long a run takes with the random gap between messages. */
function sendingTime(count: number) {
  if (count <= 1) return 'One SMS.';
  return `Takes about ${gapMinutes(count - 1)}: the phone waits ${gapSeconds()} between messages, at random, so the branch SIM is not flagged.`;
}

/** Messages grouped by arrival day, newest day first. */
function byDay(items: NotifyItem[]) {
  const days = new Map<string, NotifyItem[]>();
  for (const i of items) days.set(i.day, [...(days.get(i.day) ?? []), i]);
  return [...days].sort(([a], [b]) => b.localeCompare(a));
}

const DAY_SHOWN = 5;

/** The run's one arrival day, open so staff read through it, showing its first few until asked for all. */
function DayMessages({ day, items }: { day: string; items: (NotifyItem & { sim?: number })[] }) {
  const [all, setAll] = useState(false);
  const label = batchLabel(day);
  const parcels = items.reduce((n, i) => n + i.codes.length, 0);
  const shown = all ? items : items.slice(0, DAY_SHOWN);
  return (
    <details open className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
        <span className="font-medium">Arrived {label}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {items.length} SMS · {parcels} {parcels === 1 ? 'parcel' : 'parcels'}
        </span>
      </summary>
      <ul className="divide-y border-t">
        {shown.map((i) => (
          <li key={`${i.day}|${i.phone}`} className="px-3 py-2.5 text-sm">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-medium">
                {i.recipient} <span className="font-mono text-xs font-normal text-muted-foreground">{formatPhone(i.phone)}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {smsScope(i.codes.length)}
                {i.sim ? ` · SIM ${i.sim}` : ''}
              </span>
            </span>
            <span className="block truncate font-mono text-xs text-muted-foreground">{i.codes.join(', ')}</span>
          </li>
        ))}
      </ul>
      {items.length > DAY_SHOWN && (
        <Button variant="link" size="sm" className="mb-1 ml-1" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </Button>
      )}
    </details>
  );
}

/**
 * The one confirmation for a whole run of one arrival day. The plan is worked out from the live records, so nothing
 * stale is sent. An earlier day carries a warning and needs staff to tick that they checked its customers.
 */
function ConfirmNotify({
  day,
  data,
  templates,
  onClose,
}: {
  day: string | null;
  data: ParcelData | null;
  templates: Parameters<typeof planNotify>[3];
  onClose: () => void;
}) {
  // One key per opening of the dialog: a second click or a retried request finds the batch and creates nothing.
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(false);
  const plan = data ? planNotify(data.parcels, data.events, new Date(), templates) : null;
  const earlier = !!day && day !== arrivalDay(new Date().toISOString());
  const items: NotifyItem[] = !plan || !day ? [] : earlier ? plan.older.filter((i) => i.day === day) : plan.today;
  // The SIMs in the phone right now decide who is texted (Phase 12); the last scan stands in until this one answers.
  const [fresh, setFresh] = useState<SimInfo[] | null>(null);
  useEffect(() => {
    if (!day) return;
    let live = true;
    setFresh(null);
    fetch('/api/gateway/sims', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && b && setFresh(b.sims))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [day]);
  const { auto, byHand } = splitBySim(items, fresh ?? data?.gateway.sims ?? []);
  const parcels = items.reduce((n, i) => n + i.codes.length, 0);
  const combined = auto.filter((i) => i.codes.length > 1).length;
  const label = day ? batchLabel(day) : '';
  const close = () => {
    setRequestKey(crypto.randomUUID());
    setError('');
    setChecked(false);
    onClose();
  };
  async function start() {
    setStarting(true);
    setError('');
    try {
      await queueBatch(requestKey, day!, checked, auto);
      close();
    } catch (e) {
      setError(`Not started. ${(e as Error).message}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <Sheet open={!!day} onOpenChange={(o) => !o && close()}>
      <SheetContent>
        {plan && (
          <>
            <header className="border-b px-6 pt-5 pb-4 pr-14">
              <SheetTitle>{earlier ? `Notify customers whose parcels arrived ${label}?` : "Notify today's customers?"}</SheetTitle>
              <SheetDescription>The gateway phone sends them one at a time, each from the SIM of its customer&apos;s carrier.</SheetDescription>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <dl className="grid grid-cols-3 gap-3">
                {(
                  [
                    ['Customers', items.length],
                    ['SMS', auto.length],
                    ['By hand', byHand.length],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="font-mono text-2xl font-medium">{n}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-sm text-muted-foreground">
                {parcels} {parcels === 1 ? 'parcel' : 'parcels'}. {combined} combined, {auto.length - combined} individual SMS. One SMS per phone number. Parcels already
                notified are left out.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{auto.length > 0 ? sendingTime(auto.length) : 'Nothing goes by SMS.'}</p>
              <CarrierTable items={items} sims={fresh ?? data?.gateway.sims ?? []} className="mt-4" />
              {fresh === null && <p className="mt-1 text-xs text-muted-foreground">Checking the gateway phone&apos;s SIMs…</p>}
              {byHand.length > 0 && (
                <p className="mt-3 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
                  {byHand.length === 1 ? '1 customer is' : `${byHand.length} customers are`} on a carrier with no confirmed SIM in the gateway phone. They are listed
                  on the Contact by hand tab.
                </p>
              )}
              {earlier && (
                <div className="mt-4 rounded-md bg-warning-tint p-3 text-sm text-warning">
                  <p className="font-medium">These parcels arrived {label}, not today.</p>
                  <p className="mt-1">
                    They go as their own batch and never join today&apos;s messages. Since then, some customers may have collected their parcel or been
                    told another way. Read through the list below before sending.
                  </p>
                  <label className="mt-3 flex min-h-11 items-start gap-2 text-foreground sm:min-h-8">
                    <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
                    {items.length === 1 ? 'I checked this customer' : `I checked these ${items.length} customers`} and they still need this message.
                  </label>
                </div>
              )}
              {!earlier && plan.noPhoneToday.length > 0 && (
                <p className="mt-3 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
                  {plan.noPhoneToday.length === 1 ? "1 of today's parcels has no phone number and is" : `${plan.noPhoneToday.length} of today's parcels have no phone number and are`}{' '}
                  skipped. They are listed under Needs your attention.
                </p>
              )}
              <h3 className="mt-5 text-sm font-medium">
                {auto.length === 1 ? '1 message' : `${auto.length} messages`} to send
              </h3>
              <div className="mt-2 divide-y rounded-md border">
                {byDay(auto).map(([day, list]) => (
                  <DayMessages key={day} day={day} items={list} />
                ))}
              </div>
            </div>
            {/* Outside the scrolling list, so Start queue stays in view however many customers there are. */}
            <footer className="flex flex-wrap items-center gap-2 border-t px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {/* Until the shared wording has loaded, the messages would carry the default wording. */}
              <Button disabled={!templates || auto.length === 0 || starting || (earlier && !checked)} onClick={start}>
                <Send aria-hidden />
                {starting ? 'Starting…' : earlier ? `Send ${auto.length} SMS for ${label}` : `Start queue (${auto.length} SMS)`}
              </Button>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              {error && (
                <p role="alert" className="w-full text-sm text-destructive">
                  {error}
                </p>
              )}
            </footer>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Compact, secondary record: latest ten first, searchable, with more on request. */
function History({
  events,
  data,
  nameOf,
  initialChannel,
}: {
  events: ContactEvent[] | null;
  data: ParcelData | null;
  nameOf: (code: string) => string;
  initialChannel?: string;
}) {
  const [query, setQuery] = useState('');
  const [dates, setDates] = useState<DateRange>(ANY_DATE);
  const [channel, setChannel] = useState<ChannelFilter>(CHANNEL_FILTERS.find((f) => f.key === initialChannel)?.key ?? 'all');
  const [limit, setLimit] = useState(PAGE);
  // Any change of filter starts again from the newest ten.
  const narrow =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setLimit(PAGE);
    };

  const text = query.trim().toLowerCase();
  const digits = normalizePhone(text).replace(/^0/, '');
  const matches = (e: ContactEvent) =>
    !text ||
    e.parcelCodes.some((c) => c.toLowerCase().includes(text.replace(/\s+/g, '')) || nameOf(c).toLowerCase().includes(text)) ||
    (digits.length >= 3 && e.phone.includes(digits));
  const found = events?.filter((e) => !waiting(e) && inDateRange(e.at, dates) && (channel === 'all' || e.channel === channel) && matches(e)) ?? null;
  const shown = found?.slice(0, limit) ?? null;
  const narrowed = !!text || !isAnyDate(dates) || channel !== 'all';

  return (
    <section aria-labelledby="log-heading" className="mt-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Heading id="log-heading" title="History" hint="Every SMS, call, Telegram message and SMS sent from a staff phone. A combined SMS is one entry." />
        {events && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <label htmlFor="history-search" className="sr-only">
                Search history by phone, name or tracking code
              </label>
              <Input
                id="history-search"
                type="search"
                value={query}
                onChange={(e) => narrow(setQuery)(e.target.value)}
                placeholder="Phone, name or code"
                className="w-56 pl-9 sm:h-8"
                autoComplete="off"
              />
            </div>
            <DateFilter value={dates} onChange={narrow(setDates)} label="Date of message or call" compact />
            <div role="group" aria-label="Channel" className="flex flex-wrap gap-1">
              {CHANNEL_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={channel === f.key}
                  onClick={() => narrow(setChannel)(f.key)}
                  className={cn(
                    'inline-flex h-11 items-center rounded-sm border px-3 text-sm sm:h-8',
                    channel === f.key ? 'border-primary bg-accent font-medium text-primary' : 'bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg bg-card">
        {!shown || !data ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="px-5 py-8">
            <p className="font-medium">{narrowed ? 'Nothing matches' : 'No messages or calls yet'}</p>
            <p className="mt-1 text-muted-foreground">
              {narrowed
                ? `Try another search${isAnyDate(dates) ? '' : ` or a wider date range than ${rangePhrase(dates)}`}.`
                : "Use Notify today's customers, or contact a customer from a scanned parcel."}
            </p>
            {narrowed && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setQuery('');
                  setDates(ANY_DATE);
                  setChannel('all');
                  setLimit(PAGE);
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <>
            <HistoryTable events={shown} nameOf={nameOf} />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-sm text-muted-foreground">
              <span>
                Showing {shown.length} of {found!.length}
              </span>
              {found!.length > shown.length && (
                <Button variant="outline" size="sm" onClick={() => setLimit(limit + PAGE)}>
                  Show {Math.min(PAGE, found!.length - shown.length)} older
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// Telegram outcomes already name their channel; a call needs it said.
function channelText(e: ContactEvent) {
  if (e.channel === 'sms') return `${e.parcelCodes.length > 1 ? `Combined SMS · ${e.parcelCodes.length} parcels` : 'SMS'}${e.sim ? ` · SIM ${e.sim}` : ''}`;
  if (!e.outcome || e.channel === 'other') return CHANNEL[e.channel].label;
  return e.channel === 'call' ? `Call · ${OUTCOME[e.outcome]}` : OUTCOME[e.outcome];
}

function HistoryTable({ events, nameOf }: { events: ContactEvent[]; nameOf: (code: string) => string }) {
  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="hidden pl-5 xl:table-cell">Time</TableHead>
          <TableHead className="pl-3 sm:pl-5 xl:pl-3">Phone</TableHead>
          <TableHead className="hidden sm:table-cell">Parcels</TableHead>
          <TableHead className="pr-3">Channel</TableHead>
          <TableHead className="hidden md:table-cell">SMS</TableHead>
          <TableHead className="hidden pr-5 xl:table-cell">Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((e) => {
          const Icon = CHANNEL[e.channel].icon;
          const time = (
            <time dateTime={e.at} className="block font-mono text-xs text-muted-foreground">
              {formatDateTime(e.at)}
            </time>
          );
          // Every parcel record the entry covers, each linked to its own row.
          const codes = (
            <span className="flex flex-col font-mono text-xs leading-5">
              {e.parcelCodes.map((c) => (
                <Link key={c} href={`/parcels?q=${c}`} className="text-primary underline-offset-4 hover:underline" aria-label={`Open parcel ${c}`}>
                  {c}
                </Link>
              ))}
            </span>
          );
          return (
            <TableRow key={e.id} className="align-top">
              <TableCell className="hidden py-2 pl-5 xl:table-cell">{time}</TableCell>
              <TableCell className="py-2 pl-3 whitespace-normal sm:pl-5 sm:whitespace-nowrap xl:pl-3">
                <span className="block font-mono whitespace-nowrap">{formatPhone(e.phone)}</span>
                <span className="block text-xs text-muted-foreground">{nameOf(e.parcelCodes[0])}</span>
                <span className="xl:hidden">{time}</span>
                <span className="sm:hidden">{codes}</span>
              </TableCell>
              <TableCell className="hidden py-2 sm:table-cell">{codes}</TableCell>
              <TableCell className="py-2 pr-3 whitespace-normal">
                <span className="flex items-center gap-1.5">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {channelText(e)}
                </span>
                {/* Narrow screens: the SMS status and the result stack under the channel. */}
                {e.smsStatus && (
                  <span className="mt-1 flex md:hidden">
                    <SmsBadge status={e.smsStatus} />
                  </span>
                )}
                {e.result && <span className="mt-1 block text-xs text-muted-foreground xl:hidden">{e.result}</span>}
              </TableCell>
              <TableCell className="hidden py-2 md:table-cell">
                {e.smsStatus ? <SmsBadge status={e.smsStatus} bare /> : <span className="text-muted-foreground">–</span>}
              </TableCell>
              <TableCell className="hidden max-w-72 py-2 pr-5 whitespace-normal text-muted-foreground xl:table-cell">{e.result}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function RetrySheet({ event, data, onClose }: { event: ContactEvent | null; data: ParcelData | null; onClose: () => void }) {
  const [text, setText] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [sendAnyway, setSendAnyway] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (event && data && key !== event.id) {
    const name = data.parcels.find((p) => p.code === event.parcelCodes[0])?.recipient ?? '';
    setKey(event.id);
    setText(event.message || composeMessage(name, event.parcelCodes, currentTemplates()));
    setSendAnyway(false);
    setError('');
  }
  // Re-checked at confirm time: another tab or a scan may have sent one meanwhile.
  const blocked = !!event && !!data && smsInFlight(event.parcelCodes, data.events);
  // An unconfirmed SMS may well have arrived: resending needs a deliberate choice, never a reflex click.
  const uncertain = event?.smsStatus === 'unconfirmed';

  return (
    <Sheet open={!!event} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        {event && (
          <>
            <header className="border-b px-6 pt-5 pb-4 pr-14">
              <SheetTitle>Retry SMS to {formatPhone(event.phone)}</SheetTitle>
              <SheetDescription>
                Last attempt {formatDateTime(event.at)}: {event.result}
              </SheetDescription>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <p className="font-medium">{smsScope(event.parcelCodes.length)}</p>
              <p className="mt-1 font-mono text-sm">{event.parcelCodes.join(', ')}</p>
              {uncertain && (
                <div className="mt-4 rounded-md bg-warning-tint p-3 text-sm text-warning">
                  <p className="font-medium">This message may already have reached the customer.</p>
                  <p className="mt-1">The gateway sent it but never confirmed delivery. A call or a Telegram check is safer than sending it again.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline" className="bg-card">
                      <a href={`tel:${event.phone}`}>
                        <Phone aria-hidden />
                        Call
                      </a>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="bg-card">
                      <a href={telegramLink(event.phone)} target="_blank" rel="noreferrer">
                        <MessageSquare aria-hidden />
                        Telegram
                      </a>
                    </Button>
                  </div>
                  <label className="mt-3 flex min-h-11 items-center gap-2 text-foreground sm:min-h-8">
                    <input type="checkbox" checked={sendAnyway} onChange={(e) => setSendAnyway(e.target.checked)} className="size-4 accent-primary" />
                    Send it again anyway
                  </label>
                </div>
              )}
              <label htmlFor="retry-text" className="mt-4 block text-xs text-muted-foreground">
                Message preview, edit before sending
              </label>
              <textarea
                id="retry-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                className="mt-1 w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-base sm:text-sm"
              />
              <p className="mt-2 text-sm text-muted-foreground">This sends the same message again as a new attempt (a new message if you edit it). The earlier attempt stays in the history.</p>
              {data && event.parcelCodes.every((c) => reachedByStaff(c, data.events)) && (
                <p className="mt-2 text-sm">Staff already reached this customer another way, so this message may not be needed.</p>
              )}
              {blocked && (
                <p role="alert" className="mt-3 rounded-md bg-warning-tint p-3 text-sm text-warning">
                  An SMS for these parcels is already waiting at the gateway. Wait for it before retrying.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  disabled={blocked || saving || !text.trim() || (uncertain && !sendAnyway)}
                  onClick={async () => {
                    setSaving(true);
                    setError('');
                    try {
                      await queueSms(event.phone, event.parcelCodes, text, { retryOf: event.id });
                      onClose();
                    } catch (e) {
                      setError(`Not queued. ${(e as Error).message}`);
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  <Send aria-hidden />
                  Queue retry
                </Button>
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
              </div>
              {error && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

const BY_HAND_SHOWN = 8;
type ByHandItem = NotifyItem & { carrier: Carrier | null };

/**
 * Customers the gateway phone cannot text, because their carrier has no confirmed SIM in it right now (Phase 12, owner
 * 2026-10-23: no fallback SIM). A line told by Telegram or an SMS from a staff phone leaves the list.
 */
function byHandList(plan: ReturnType<typeof planNotify> | null, data: ParcelData | null, sims: SimInfo[]): ByHandItem[] {
  if (!plan || !data) return [];
  const told = (codes: string[]) =>
    data.events.some((e) => (e.channel === 'telegram' || e.channel === 'other') && e.outcome === 'messaged' && e.parcelCodes.some((c) => codes.includes(c)));
  return splitBySim([...plan.today, ...plan.older], sims).byHand.filter((i) => !told(i.codes));
}

/** The Contact by hand tab: staff call them, message them on Telegram or send the SMS from their own phone. */
function ContactByHand({ list, data }: { list: ByHandItem[]; data: ParcelData | null }) {
  const [all, setAll] = useState(false);
  if (!data) return <Skeleton className="h-40 w-full" />;
  const shown = all ? list : list.slice(0, BY_HAND_SHOWN);
  return (
    <section aria-labelledby="by-hand-heading" className="rounded-lg bg-card px-5 py-5 sm:px-7">
      <Heading
        id="by-hand-heading"
        title="Contact by hand"
        count={list.length}
        hint="Their carrier has no SIM in the gateway phone, so no SMS goes to them. Call, use Telegram, or send the SMS from your own phone; the app then asks what happened."
      />
      {list.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <CircleCheck className="size-4 text-success" aria-hidden />
          Nobody to contact by hand. Every customer&apos;s carrier has a SIM in the gateway phone, or they were told already.
        </p>
      ) : (
        <ul className="mt-2 divide-y">
          {shown.map((i) => (
            <ByHandRow key={`${i.day}|${i.phone}`} item={i} data={data} />
          ))}
        </ul>
      )}
      {list.length > BY_HAND_SHOWN && (
        <Button variant="link" size="sm" className="mt-1 px-0" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${list.length}`}
        </Button>
      )}
    </section>
  );
}

/** One customer to contact by hand, with the same Call, Telegram and SMS card as the parcel page. */
function ByHandRow({ item, data }: { item: ByHandItem; data: ParcelData }) {
  const group = data.parcels.filter((p) => item.codes.includes(p.code));
  const today = item.day === arrivalDay(new Date().toISOString());
  if (!group.length) return null;
  return (
    <li className="py-4">
      <p>
        <span className="font-medium">{item.recipient}</span> <span className="font-mono text-sm text-muted-foreground">{formatPhone(item.phone)}</span>
      </p>
      <p className="mb-2 text-xs text-muted-foreground">
        {item.carrier ? `${CARRIER_LABEL[item.carrier]}: no ${CARRIER_LABEL[item.carrier]} SIM in the gateway phone` : 'Prefix not on the carrier list'} ·{' '}
        {item.codes.length === 1 ? '1 parcel' : `${item.codes.length} parcels`} · <span className="font-mono">{item.codes.join(', ')}</span>
        {!today && ` · arrived ${batchLabel(item.day)}`}
      </p>
      <DirectContact parcel={group[0]} group={group} events={data.events} message={item.message} stops={0} compact />
    </li>
  );
}

/**
 * While a run goes (Phase 12, owner 2026-10-23): the browser tab says how far it is, a chime plays when it finishes,
 * and three beeps play when it needs someone, again every 30 seconds (at most 5 times) until someone clicks or types.
 * Sounds play only on a change seen with this page open, never on its first load.
 */
function RunAlerts({ data }: { data: ParcelData | null }) {
  const base = useRef('');
  const last = useRef<{ batchId: number | null; status?: string; failed: number; needs: boolean } | null>(null);
  const repeat = useRef<number | null>(null);

  const batch = data?.batch ? data.events.filter((e) => data.batch!.eventIds.includes(e.id)) : [];
  const done = batch.length - batch.filter(waiting).length;
  const failed = batch.filter((e) => e.smsStatus === 'failed' || e.smsStatus === 'unconfirmed').length;
  const status = data?.batch?.status;
  const queued = !!data?.events.some((e) => e.smsStatus === 'queued');
  const awayLong = !!data?.gateway.awaySince && Date.now() - Date.parse(data.gateway.awaySince) > 5 * 60_000;
  const needs = !!data && ((status === 'paused' && data.gateway.simPause !== null) || (queued && (awayLong || data.gateway.simMissing.length > 0)));

  const stop = () => {
    if (repeat.current !== null) window.clearInterval(repeat.current);
    repeat.current = null;
  };
  useEffect(() => {
    base.current = document.title;
    window.addEventListener('pointerdown', stop);
    window.addEventListener('keydown', stop);
    return () => {
      document.title = base.current;
      stop();
      window.removeEventListener('pointerdown', stop);
      window.removeEventListener('keydown', stop);
    };
  }, []);

  useEffect(() => {
    if (!base.current) return;
    document.title =
      !data?.batch || status === 'stopped'
        ? base.current
        : needs
          ? `Needs attention · ${base.current}`
          : status === 'done'
            ? `Done · ${base.current}`
            : `(${done}/${batch.length}) ${status === 'paused' ? 'Paused' : 'Sending'} · ${base.current}`;
  });

  useEffect(() => {
    if (!data) return;
    const now = { batchId: data.batch?.id ?? null, status, failed, needs };
    const before = last.current;
    last.current = now;
    if (!needs) stop();
    if (!before) return;
    if (before.batchId === now.batchId && before.status === 'running' && status === 'done') playDone();
    if ((needs && !before.needs) || (before.batchId === now.batchId && failed > before.failed)) {
      stop();
      playAttention();
      let times = 1;
      repeat.current = window.setInterval(() => (++times > 5 ? stop() : playAttention()), 30_000);
    }
  });
  return null;
}
