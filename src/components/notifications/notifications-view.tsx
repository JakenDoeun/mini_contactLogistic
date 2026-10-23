'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Camera, Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, MessageSquare, ScanBarcode, X, Pause, Phone, PhoneOff, Play, RotateCcw, Search, Send, Smartphone, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CameraScanner } from '@/components/parcels/camera-scanner';
import { DirectContact } from '@/components/parcels/contact-panel';
import { ParcelDetail } from '@/components/parcels/parcel-detail';
import { SmsBadge } from '@/components/parcels/parcel-status';
import { batchLabel } from '@/components/parcels/phone-group';
import { CARRIER_DOT } from '@/components/shared/carrier-chips';
import { CarrierTable } from '@/components/shared/carrier-table';
import { DateFilter } from '@/components/shared/date-filter';
import { CARRIER_LABEL, splitBySim, type Carrier, type SimInfo } from '@/lib/carriers';
import { byHandGroups, planNotify, verifyForLine, workList, type ByHandGroup, type ByHandLine, type LineCheck, type NotifyItem } from '@/lib/dashboard-logic';
import { ANY_DATE, inDateRange, isAnyDate, rangePhrase, type DateRange } from '@/lib/date-range';
import {
  arrivalDay,
  composeMessage,
  reachedByStaff,
  formatPhone,
  normalizePhone,
  smsInFlight,
  telegramLink,
  type Channel,
  type ContactEvent,
} from '@/lib/parcel-logic';
import { controlBatch, dismissBatch, queueBatch, queueSms, reloadParcels, releaseRestoreHold, useParcelData, type ParcelData, type SmsBatch } from '@/lib/parcel-service';
import { currentGap, currentTemplates, useSettings } from '@/lib/settings-service';
import { playAttention, playDone } from '@/lib/sounds';
import { cn, formatDateTime, formatTime } from '@/lib/utils';
import { useT, type MessageKey } from '@/lib/i18n-react';

type T = ReturnType<typeof useT>;

type ChannelFilter = 'all' | 'sms' | 'call' | 'telegram' | 'other';
const CHANNEL_FILTERS: { key: ChannelFilter; label: MessageKey }[] = [
  { key: 'all', label: 'n.ch.all' },
  { key: 'sms', label: 'n.ch.sms' },
  { key: 'call', label: 'n.ch.calls' },
  { key: 'telegram', label: 'n.ch.telegram' },
  { key: 'other', label: 'n.ch.other' },
];

const CHANNEL: Record<Channel, { label: MessageKey; icon: typeof Send }> = {
  sms: { label: 'n.channel.sms', icon: Send },
  call: { label: 'n.channel.call', icon: Phone },
  telegram: { label: 'n.channel.telegram', icon: MessageSquare },
  other: { label: 'n.channel.other', icon: Smartphone },
};
const OUTCOME: Record<string, MessageKey> = { answered: 'event.outcome.answered', 'no-answer': 'event.outcome.noAnswer', messaged: 'event.outcome.messaged' };

const waiting = (e: ContactEvent) => e.smsStatus === 'queued' || e.smsStatus === 'sending';
const PAGE = 10;
const READY_SHOWN = 6;

type Tab = 'today' | 'by-hand' | 'history';
const TABS: { key: Tab; label: MessageKey }[] = [
  { key: 'today', label: 'n.tab.today' },
  { key: 'by-hand', label: 'n.tab.byHand' },
  { key: 'history', label: 'n.tab.history' },
];

export function NotificationsView({ initialFilter, initialTab = 'today' }: { initialFilter?: string; initialTab?: Tab }) {
  const t = useT();
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
  const byHandByNetwork = plan && data ? byHandGroups(plan, data.parcels, data.events, sims) : [];
  const byHand = byHandByNetwork.reduce((n, g) => n + g.lines.length, 0);

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">{t('nav.notifications')}</h1>
          <p className="mt-1 text-muted-foreground">{t('n.lead')}</p>
        </div>
      </div>

      {data?.restoreHold && <RestoreCheck data={data} copyAt={data.restoreHold.copyAt} />}

      <div
        role="tablist"
        aria-label={t('nav.notifications')}
        className="mt-6 flex gap-1 border-b"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          const i = TABS.findIndex((x) => x.key === tab);
          const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].key;
          choose(next);
          document.getElementById(`tab-${next}`)?.focus();
        }}
      >
        {TABS.map((x) => (
          <button
            key={x.key}
            id={`tab-${x.key}`}
            type="button"
            role="tab"
            aria-selected={tab === x.key}
            aria-controls={`panel-${x.key}`}
            tabIndex={tab === x.key ? 0 : -1}
            onClick={() => choose(x.key)}
            className={cn(
              '-mb-px min-h-11 border-b-2 px-4 text-sm font-medium transition-colors motion-reduce:transition-none',
              tab === x.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(x.label)}
            {x.key === 'by-hand' && byHand > 0 && (
              <span className="ml-2 rounded-full bg-warning-tint px-2 py-0.5 font-mono text-xs font-medium text-warning">
                <span className="sr-only">, </span>
                {byHand}
                <span className="sr-only">{t('n.waiting')}</span>
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
          byHand={byHand}
          onNotify={setConfirmDay}
          onByHand={() => choose('by-hand')}
        />
      </div>

      <div id="panel-by-hand" role="tabpanel" aria-labelledby="tab-by-hand" hidden={tab !== 'by-hand'} className="mt-7">
        <ContactByHand groups={byHandByNetwork} data={data} />
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
  const t = useT();
  const total = work ? work.retry.length + work.noPhone.length : undefined;
  return (
    <section aria-labelledby="attention-heading" className="rounded-lg bg-card px-5 py-6 sm:px-7">
      <Heading
        id="attention-heading"
        title={t('n.att.title')}
        count={total}
        tone={total ? 'destructive' : 'neutral'}
        hint={t('n.att.hint')}
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
            <p className="font-medium">{t('n.att.clear')}</p>
            <p className="text-sm text-muted-foreground">{t('n.att.clearLead')}</p>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-6">
          {work.retry.length > 0 && (
            <AttentionGroup label={t('n.att.failed')}>
              {work.retry.map((e) => (
                <AttentionItem
                  key={e.id}
                  tone={e.smsStatus === 'failed' ? 'destructive' : 'warning'}
                  title={nameOf(e.parcelCodes[0])}
                  phone={e.phone}
                  line={`${t('sms.scope', { count: e.parcelCodes.length })} · ${e.result ?? ''}`}
                  codes={e.parcelCodes}
                  status={<SmsBadge status={e.smsStatus!} />}
                >
                  {/* An unconfirmed SMS may have arrived, so its retry is the quieter button. */}
                  <Button
                    size="sm"
                    variant={e.smsStatus === 'failed' ? 'default' : 'outline'}
                    onClick={() => onRetry(e)}
                    aria-label={t('n.att.retryFor', { phone: formatPhone(e.phone) })}
                  >
                    <RotateCcw aria-hidden />
                    {t('n.att.retry')}
                  </Button>
                  <ReachLinks phone={e.phone} />
                </AttentionItem>
              ))}
            </AttentionGroup>
          )}
          {work.noPhone.length > 0 && (
            <AttentionGroup label={t('n.att.noPhone')}>
              {work.noPhone.map((p) => (
                <AttentionItem
                  key={p.code}
                  tone="warning"
                  title={p.recipient}
                  line={t('n.att.importedFrom', { time: formatDateTime(p.importedAt), file: p.sourceFile })}
                  codes={[p.code]}
                  status={
                    <span className="inline-flex items-center gap-1 text-sm text-warning">
                      <PhoneOff className="size-3.5" aria-hidden />
                      {p.phone.trim() ? t('n.att.invalid') : t('n.att.noNumber')}
                    </span>
                  }
                >
                  <Button size="sm" variant="outline" onClick={() => onOpen(p.code)}>
                    {t('groups.addPhone')}
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

function ReachLinks({ phone }: { phone: string }) {
  const t = useT();
  return (
    <>
      <Button asChild size="sm" variant="ghost">
        <a href={`tel:${phone}`} aria-label={t('n.callFor', { phone: formatPhone(phone) })}>
          <Phone aria-hidden />
          {t('contact.call')}
        </a>
      </Button>
      <Button asChild size="sm" variant="ghost">
        <a href={telegramLink(phone)} target="_blank" rel="noreferrer" aria-label={t('n.telegramFor', { phone: formatPhone(phone) })}>
          <MessageSquare aria-hidden />
          {t('contact.telegram')}
        </a>
      </Button>
    </>
  );
}

/** The SMS gateway queue: what is waiting, what is being handed over, and how the latest run is going. */
function SendingQueue({ data, nameOf, running }: { data: ParcelData | null; nameOf: (code: string) => string; running: boolean }) {
  const t = useT();
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
        {t('n.q.empty')}
      </p>
    );
  }
  return (
    <section aria-labelledby="queue-heading" className="rounded-lg bg-accent/70 px-5 py-5 sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Heading
          id="queue-heading"
          title={t('n.q.title')}
          hint={t('n.q.hint', { gap: gapSeconds(t) })}
        />
        {running && data.batch && <BatchControls batch={data.batch} />}
        {batch.length > 0 && !running && (
          <Button size="sm" variant="ghost" onClick={dismissBatch}>
            {t('n.q.dismiss')}
          </Button>
        )}
      </div>

      {batch.length > 0 && (
        <div className="mt-4">
          <p aria-live="polite" className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
            <span className="font-medium">
              {data.batch?.status === 'paused'
                ? t('n.q.paused', { done, total: batch.length })
                : running && stuck
                  ? t('n.q.waitingPhone', { done, total: batch.length })
                  : running
                    ? t('n.q.sending', { current: Math.min(done + 1, batch.length), total: batch.length })
                    : data.batch?.status === 'stopped'
                      ? t('n.q.stopped', { done: batch.length - tally('not-sent'), total: batch.length })
                      : t('n.q.finished', { total: batch.length })}
            </span>
            <span className="text-muted-foreground">
              {t('n.q.tally', { sent: tally('sent') + tally('delivered'), failed: tally('failed'), unconfirmed: tally('unconfirmed') })}
              {running && t('n.q.toGo', { count: batch.length - done })}
              {running && !stuck && data.batch?.status === 'running' && t('n.q.left', { time: gapMinutes(batch.length - done, t) })}
            </span>
          </p>
          <div
            role="progressbar"
            aria-label={t('n.q.progress')}
            aria-valuemin={0}
            aria-valuemax={batch.length}
            aria-valuenow={done}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-card"
          >
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(done / batch.length) * 100}%` }} />
          </div>
          {perSim.length > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">{perSim.map((p) => t('n.q.perSim', { sim: p.sim, done: p.done, total: p.total })).join(' · ')}</p>
          )}
        </div>
      )}

      {data.gateway.simPause !== null && data.batch?.status === 'paused' && (
        <p role="status" className="mt-4 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
          {t('n.q.simPause', { sim: data.gateway.simPause })}
        </p>
      )}
      {missing.map((m) => (
        <MissingSim key={m.sim} sim={m.sim} count={m.count} />
      ))}

      {stuck && (
        <p role="status" className="mt-4 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
          {!data.gateway.setUp ? t('n.q.noGateway') : t('n.q.away', { time: formatTime(data.gateway.awaySince!) })}
        </p>
      )}

      {inFlight.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {inFlight.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-card px-3 py-2.5">
              <span className="min-w-0 flex-1 basis-56">
                <span className="font-medium">{nameOf(e.parcelCodes[0])}</span> <span className="font-mono text-sm text-muted-foreground">{formatPhone(e.phone)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t('sms.scope', { count: e.parcelCodes.length })} · <span className="font-mono">{e.parcelCodes.join(', ')}</span>
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
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function release() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/gateway/sims', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ release: sim }) });
      if (!res.ok) throw new Error(t('n.miss.notChanged', { status: res.status }));
      await reloadParcels();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <div role="status" className="mt-4 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
      <p>{t('n.miss.text', { sim, count })}</p>
      <Button size="sm" variant="outline" className="mt-2 bg-card" disabled={busy} onClick={release}>
        {busy ? t('n.miss.moving') : t('n.miss.release')}
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
  const t = useT();
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
      setError(t('common.notSaved', { error: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section aria-labelledby="restore-heading" className="mt-7 rounded-lg border border-warning/40 bg-warning-tint px-5 py-5 sm:px-7">
      <h2 id="restore-heading" className="font-semibold text-warning">
        {t('n.restore.title')}
      </h2>
      <p className="mt-1 text-sm">
        {t('n.restore.lead', { time: formatDateTime(copyAt) })}
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
        <li>{t('n.restore.step1', { time: formatDateTime(copyAt) })}</li>
        <li>{t('n.restore.step2')}</li>
        <li>{t('n.restore.step3')}</li>
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
                    {t('n.arrived', { day: batchLabel(g.day, t) })} · <span className="font-mono">{g.codes.join(', ')}</span>
                  </span>
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{seen.has(keyOf(g)) ? t('n.restore.gotSms') : ''}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{t('n.restore.none')}</p>
      )}
      <label className="mt-4 flex min-h-11 items-start gap-2 text-sm font-medium sm:min-h-8">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
        {t('n.restore.checked', { time: formatDateTime(copyAt) })}
      </label>
      <Button className="mt-3" disabled={!checked || saving} onClick={resume}>
        {saving ? t('common.saving') : seen.size ? t('n.restore.save', { count: seen.size }) : t('n.restore.resume')}
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
  const t = useT();
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
        {paused ? t('n.ctl.resume') : t('n.ctl.pause')}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => act('stop')}>
        <Square aria-hidden />
        {t('n.ctl.stop')}
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
  const t = useT();
  const parcels = plan?.today.reduce((n, i) => n + i.codes.length, 0) ?? 0;
  const split = plan ? splitBySim(plan.today, sims) : null;
  const noSim = !noGateway && !sims.some((s) => s.carrier);
  return (
    <aside aria-labelledby="ready-heading" className="rounded-lg bg-secondary/70 px-5 py-5">
      <h2 id="ready-heading" className="font-semibold">
        {t('n.ready.title')}
      </h2>
      {!plan ? (
        <Skeleton className="mt-3 h-24 w-full" />
      ) : (
        <>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {plan.today.length} <span className="text-base font-normal text-muted-foreground">{t('n.ready.customers', { count: plan.today.length })}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            {t('n.ready.parcels', { count: parcels })}
          </p>
          {split && plan.today.length > 0 && !noGateway && (
            <>
              <p className="text-sm text-muted-foreground">
                {t('n.ready.split', { auto: split.auto.length, byHand: split.byHand.length })}
              </p>
              <CarrierTable items={plan.today} sims={sims} className="mt-3" compact />
            </>
          )}
          {byHand > 0 && (
            <button type="button" onClick={onByHand} className="mt-1 min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline sm:min-h-8">
              {t('n.ready.openByHand', { count: byHand })}
            </button>
          )}
          <Button className="mt-4 w-full" onClick={() => onNotify(arrivalDay(new Date().toISOString()))} disabled={running || hold || noGateway || plan.today.length === 0}>
            <Send aria-hidden />
            {t('n.ready.notify')}
          </Button>
          {running && <p className="mt-2 text-xs text-muted-foreground">{t('n.ready.running')}</p>}
          {hold && <p className="mt-2 text-xs text-warning">{t('n.ready.hold')}</p>}
          {noSim && (
            <p className="mt-2 text-xs text-warning">
              {t.rich('n.ready.noSim', {
                link: (
                  <Link href="/settings" className="font-medium underline underline-offset-4">
                    {t('n.ready.settingsLink')}
                  </Link>
                ),
              })}
            </p>
          )}
          {noGateway && (
            <p className="mt-2 text-xs text-warning">
              {t.rich('n.ready.noGateway', {
                link: (
                  <Link href="/settings" className="font-medium underline underline-offset-4">
                    {t('n.ready.settingsLink')}
                  </Link>
                ),
              })}
            </p>
          )}

          {plan.today.length === 0 ? (
            <div className="mt-4 text-sm">
              <p className="font-medium">{t('n.ready.allNotified')}</p>
              <Link
                href="/import-arrivals"
                className="mt-1 inline-flex min-h-11 items-center gap-1 font-medium text-primary underline-offset-4 hover:underline sm:min-h-8"
              >
                {t('parcels.importLink')}
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
                  <span className="shrink-0 text-xs text-muted-foreground">{t('n.parcels', { count: i.codes.length })}</span>
                </li>
              ))}
              {plan.today.length > READY_SHOWN && <li className="py-2 text-xs text-muted-foreground">{t('n.andMore', { count: plan.today.length - READY_SHOWN })}</li>}
            </ul>
          )}
          {plan.noPhoneToday.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              <li>{t('n.ready.noPhoneSkipped', { count: plan.noPhoneToday.length })}</li>
            </ul>
          )}
          {plan.older.length > 0 && (
            <div className="mt-5 border-t pt-4">
              <h3 className="text-sm font-medium">{t('n.ready.older')}</h3>
              <p className="text-xs text-muted-foreground">{t('n.ready.olderLead')}</p>
              <ul className="mt-2 divide-y divide-border/70 text-sm">
                {byDay(plan.older).map(([day, list]) => (
                  <li key={day} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      {t('n.arrived', { day: batchLabel(day, t) })}{' '}
                      <span className="text-xs text-muted-foreground">{t('n.ready.olderCount', { count: list.length })}</span>
                    </span>
                    <Button size="sm" variant="outline" className="shrink-0 bg-card" disabled={running || hold || noGateway} onClick={() => onNotify(day)}>
                      {t('n.ready.review')}
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

/** How long this many gaps between messages take; the gap is random, so it is a range. */
function gapMinutes(gaps: number, t: T) {
  const { from: lo, to: hi } = currentGap();
  const [a, b] = [Math.max(1, Math.round((gaps * lo) / 60)), Math.max(1, Math.ceil((gaps * hi) / 60))];
  return a === b ? t('n.gap.minutes', { count: a }) : t('n.gap.minutesRange', { from: a, to: b });
}

/** The gap between two SMS as staff read it: "25–80 seconds", or "15 seconds" when the admin set one fixed gap. */
function gapSeconds(t: T) {
  const { from, to } = currentGap();
  return from === to ? t('n.gap.seconds', { count: from }) : t('n.gap.secondsRange', { from, to });
}

/** How long a run takes with the random gap between messages. */
function sendingTime(count: number, t: T) {
  if (count <= 1) return t('n.time.one');
  return t('n.time.takes', { time: gapMinutes(count - 1, t), gap: gapSeconds(t) });
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
  const t = useT();
  const [all, setAll] = useState(false);
  const label = batchLabel(day, t);
  const parcels = items.reduce((n, i) => n + i.codes.length, 0);
  const shown = all ? items : items.slice(0, DAY_SHOWN);
  return (
    <details open className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
        <span className="font-medium">{t('n.arrived', { day: label })}</span>
        <span className="ml-auto text-xs text-muted-foreground">{t('n.day.summary', { sms: items.length, count: parcels })}</span>
      </summary>
      <ul className="divide-y border-t">
        {shown.map((i) => (
          <li key={`${i.day}|${i.phone}`} className="px-3 py-2.5 text-sm">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-medium">
                {i.recipient} <span className="font-mono text-xs font-normal text-muted-foreground">{formatPhone(i.phone)}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {t('sms.scope', { count: i.codes.length })}
                {i.sim ? t('n.day.sim', { sim: i.sim }) : ''}
              </span>
            </span>
            <span className="block truncate font-mono text-xs text-muted-foreground">{i.codes.join(', ')}</span>
          </li>
        ))}
      </ul>
      {items.length > DAY_SHOWN && (
        <Button variant="link" size="sm" className="mb-1 ml-1" onClick={() => setAll(!all)}>
          {all ? t('n.day.fewer') : t('n.day.all', { count: items.length })}
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
  const t = useT();
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
  const label = day ? batchLabel(day, t) : '';
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
      setError(t('n.confirm.notStarted', { error: (e as Error).message }));
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
              <SheetTitle>{earlier ? t('n.confirm.titleEarlier', { day: label }) : t('n.confirm.title')}</SheetTitle>
              <SheetDescription>{t('n.confirm.lead')}</SheetDescription>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <dl className="grid grid-cols-3 gap-3">
                {(
                  [
                    ['n.confirm.customers', items.length],
                    ['n.confirm.sms', auto.length],
                    ['n.confirm.byHand', byHand.length],
                  ] as const
                ).map(([key, n]) => (
                  <div key={key}>
                    <dt className="text-xs text-muted-foreground">{t(key)}</dt>
                    <dd className="font-mono text-2xl font-medium">{n}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-sm text-muted-foreground">
                {t('n.confirm.summary', { count: parcels, combined, individual: auto.length - combined })}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{auto.length > 0 ? sendingTime(auto.length, t) : t('n.confirm.noSms')}</p>
              <CarrierTable items={items} sims={fresh ?? data?.gateway.sims ?? []} className="mt-4" />
              {fresh === null && <p className="mt-1 text-xs text-muted-foreground">{t('n.confirm.checkingSims')}</p>}
              {byHand.length > 0 && (
                <p className="mt-3 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
                  {t('n.confirm.byHandNote', { count: byHand.length })}
                </p>
              )}
              {earlier && (
                <div className="mt-4 rounded-md bg-warning-tint p-3 text-sm text-warning">
                  <p className="font-medium">{t('n.confirm.notToday', { day: label })}</p>
                  <p className="mt-1">{t('n.confirm.ownBatch')}</p>
                  <label className="mt-3 flex min-h-11 items-start gap-2 text-foreground sm:min-h-8">
                    <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
                    {t('n.confirm.checked', { count: items.length })}
                  </label>
                </div>
              )}
              {!earlier && plan.noPhoneToday.length > 0 && (
                <p className="mt-3 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
                  {t('n.confirm.noPhone', { count: plan.noPhoneToday.length })}
                </p>
              )}
              <h3 className="mt-5 text-sm font-medium">
                {t('n.confirm.messages', { count: auto.length })}
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
                {starting ? t('n.confirm.starting') : earlier ? t('n.confirm.sendEarlier', { count: auto.length, day: label }) : t('n.confirm.start', { count: auto.length })}
              </Button>
              <Button variant="outline" onClick={close}>
                {t('common.cancel')}
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
  const t = useT();
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
        <Heading id="log-heading" title={t('n.h.title')} hint={t('n.h.hint')} />
        {events && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <label htmlFor="history-search" className="sr-only">
                {t('n.h.search')}
              </label>
              <Input
                id="history-search"
                type="search"
                value={query}
                onChange={(e) => narrow(setQuery)(e.target.value)}
                placeholder={t('n.h.placeholder')}
                className="w-56 pl-9 sm:h-8"
                autoComplete="off"
              />
            </div>
            <DateFilter value={dates} onChange={narrow(setDates)} label={t('n.h.dateLabel')} compact />
            <div role="group" aria-label={t('n.h.channel')} className="flex flex-wrap gap-1">
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
                  {t(f.label)}
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
            <p className="font-medium">{narrowed ? t('n.h.nothing') : t('n.h.none')}</p>
            <p className="mt-1 text-muted-foreground">
              {narrowed ? (isAnyDate(dates) ? t('n.h.tryAnother') : t('n.h.tryWider', { range: rangePhrase(dates, t) })) : t('n.h.noneLead')}
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
                {t('parcels.clear')}
              </Button>
            )}
          </div>
        ) : (
          <>
            <HistoryTable events={shown} nameOf={nameOf} />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-sm text-muted-foreground">
              <span>
                {t('n.h.showing', { shown: shown.length, total: found!.length })}
              </span>
              {found!.length > shown.length && (
                <Button variant="outline" size="sm" onClick={() => setLimit(limit + PAGE)}>
                  {t('n.h.older', { count: Math.min(PAGE, found!.length - shown.length) })}
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
function channelText(e: ContactEvent, t: T) {
  if (e.channel === 'sms')
    return `${e.parcelCodes.length > 1 ? t('n.h.combined', { count: e.parcelCodes.length }) : t('n.channel.sms')}${e.sim ? t('n.day.sim', { sim: e.sim }) : ''}`;
  if (!e.outcome || e.channel === 'other') return t(CHANNEL[e.channel].label);
  return e.channel === 'call' ? t('n.h.callOutcome', { outcome: t(OUTCOME[e.outcome]) }) : t(OUTCOME[e.outcome]);
}

function HistoryTable({ events, nameOf }: { events: ContactEvent[]; nameOf: (code: string) => string }) {
  const t = useT();
  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="hidden pl-5 xl:table-cell">{t('n.h.col.time')}</TableHead>
          <TableHead className="pl-3 sm:pl-5 xl:pl-3">{t('n.h.col.phone')}</TableHead>
          <TableHead className="hidden sm:table-cell">{t('n.h.col.parcels')}</TableHead>
          <TableHead className="pr-3">{t('n.h.col.channel')}</TableHead>
          <TableHead className="hidden md:table-cell">{t('n.h.col.sms')}</TableHead>
          <TableHead className="hidden pr-5 xl:table-cell">{t('n.h.col.result')}</TableHead>
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
                <Link key={c} href={`/parcels?q=${c}`} className="text-primary underline-offset-4 hover:underline" aria-label={t('group.openParcel', { code: c })}>
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
                  {channelText(e, t)}
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
  const t = useT();
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
              <SheetTitle>{t('n.r.title', { phone: formatPhone(event.phone) })}</SheetTitle>
              <SheetDescription>{t('n.r.last', { time: formatDateTime(event.at), result: event.result ?? '' })}</SheetDescription>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <p className="font-medium">{t('sms.scope', { count: event.parcelCodes.length })}</p>
              <p className="mt-1 font-mono text-sm">{event.parcelCodes.join(', ')}</p>
              {uncertain && (
                <div className="mt-4 rounded-md bg-warning-tint p-3 text-sm text-warning">
                  <p className="font-medium">{t('n.r.mayHave')}</p>
                  <p className="mt-1">{t('n.r.mayHaveLead')}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline" className="bg-card">
                      <a href={`tel:${event.phone}`}>
                        <Phone aria-hidden />
                        {t('contact.call')}
                      </a>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="bg-card">
                      <a href={telegramLink(event.phone)} target="_blank" rel="noreferrer">
                        <MessageSquare aria-hidden />
                        {t('contact.telegram')}
                      </a>
                    </Button>
                  </div>
                  <label className="mt-3 flex min-h-11 items-center gap-2 text-foreground sm:min-h-8">
                    <input type="checkbox" checked={sendAnyway} onChange={(e) => setSendAnyway(e.target.checked)} className="size-4 accent-primary" />
                    {t('n.r.anyway')}
                  </label>
                </div>
              )}
              <label htmlFor="retry-text" className="mt-4 block text-xs text-muted-foreground">
                {t('n.r.preview')}
              </label>
              <textarea
                id="retry-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                className="mt-1 w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-base sm:text-sm"
              />
              <p className="mt-2 text-sm text-muted-foreground">{t('n.r.same')}</p>
              {data && event.parcelCodes.every((c) => reachedByStaff(c, data.events)) && (
                <p className="mt-2 text-sm">{t('n.r.reached')}</p>
              )}
              {blocked && (
                <p role="alert" className="mt-3 rounded-md bg-warning-tint p-3 text-sm text-warning">
                  {t('n.r.blocked')}
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
                      setError(t('n.r.notQueued', { error: (e as Error).message }));
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  <Send aria-hidden />
                  {t('n.r.queue')}
                </Button>
                <Button variant="outline" onClick={onClose}>
                  {t('common.cancel')}
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
const NETWORK_KEY = 'cb.byHandNetwork';
const networkKey = (c: Carrier | null) => c ?? 'unknown';
const networkName = (c: Carrier | null, t: T) => (c ? CARRIER_LABEL[c] : t('n.bh.unknownCarrier'));

/**
 * The Contact by hand tab (Phase 12): today's customers whose network has no SIM in the gateway phone. Staff pick their
 * own phone's network (remembered on this device) and work down the list: never tried first, then no answer. Each
 * network shows how many are not contacted yet and how many are done today.
 */
function ContactByHand({ groups, data }: { groups: ByHandGroup[]; data: ParcelData | null }) {
  const t = useT();
  const [pick, setPick] = useState('all');
  const [all, setAll] = useState(false);
  useEffect(() => {
    try {
      setPick(localStorage.getItem(NETWORK_KEY) ?? 'all');
    } catch {
      // private window or blocked storage: start from All
    }
  }, []);
  const choose = (next: string) => {
    setPick(next);
    setAll(false);
    try {
      localStorage.setItem(NETWORK_KEY, next);
    } catch {
      // not kept on this device; it applies until the page closes
    }
  };

  if (!data) return <Skeleton className="h-40 w-full" />;
  // A remembered network with nobody on it today falls back to All.
  const active = groups.some((g) => networkKey(g.carrier) === pick) ? pick : 'all';
  const inView = active === 'all' ? groups : groups.filter((g) => networkKey(g.carrier) === active);
  const left = inView.reduce((n, g) => n + g.lines.length, 0);
  const done = inView.reduce((n, g) => n + g.done, 0);
  const totalLeft = groups.reduce((n, g) => n + g.lines.length, 0);
  // The first lines in working order, then regrouped, so "Show all" never splits a network's order.
  let budget = all ? Infinity : BY_HAND_SHOWN;
  const shown = inView
    .filter((g) => g.lines.length)
    .map((g) => {
      const lines = g.lines.slice(0, Math.max(0, budget));
      budget -= lines.length;
      return { ...g, lines };
    })
    .filter((g) => g.lines.length);

  return (
    <section aria-labelledby="by-hand-heading" className="rounded-lg bg-card px-5 py-5 sm:px-7">
      <Heading
        id="by-hand-heading"
        title={t('n.bh.title')}
        count={totalLeft}
        hint={t('n.bh.hint')}
      />

      {groups.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <CircleCheck className="size-4 text-success" aria-hidden />
          {t('n.bh.nobody')}
        </p>
      ) : (
        <>
          <div role="group" aria-label={t('n.bh.network')} className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <NetworkButton label={t('n.bh.all')} left={totalLeft} noAnswer={groups.reduce((n, g) => n + g.noAnswer, 0)} pressed={active === 'all'} onClick={() => choose('all')} />
            {groups.map((g) => (
              <NetworkButton
                key={networkKey(g.carrier)}
                label={g.carrier ? CARRIER_LABEL[g.carrier] : t('n.bh.unknown')}
                dot={CARRIER_DOT[networkKey(g.carrier)]}
                left={g.lines.length}
                noAnswer={g.noAnswer}
                pressed={active === networkKey(g.carrier)}
                onClick={() => choose(networkKey(g.carrier))}
              />
            ))}
          </div>

          <div className="mt-4">
            <p className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
              <span className="font-medium">
                {t('n.bh.progress', { network: active === 'all' ? t('n.bh.allNetworks') : networkName(inView[0].carrier, t), done, total: done + left })}
              </span>
              <span className="text-muted-foreground">{left === 0 ? t('n.bh.nobodyLeft') : t('n.bh.left', { count: left })}</span>
            </p>
            <div
              role="progressbar"
              aria-label={t('n.bh.progressLabel')}
              aria-valuemin={0}
              aria-valuemax={done + left}
              aria-valuenow={done}
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary"
            >
              <div className="h-full rounded-full bg-success transition-[width] motion-reduce:transition-none" style={{ width: `${done + left ? (done / (done + left)) * 100 : 0}%` }} />
            </div>
          </div>

          {left === 0 ? (
            <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <CircleCheck className="size-4 text-success" aria-hidden />
              {active === 'all' ? t('n.bh.everyoneDone') : t('n.bh.networkDone', { network: networkName(inView[0].carrier, t) })}
            </p>
          ) : (
            shown.map((g) => {
              const id = `by-hand-${networkKey(g.carrier)}`;
              return (
                <section key={id} aria-labelledby={id} className="mt-3 border-t pt-5 first-of-type:mt-6 first-of-type:border-t-0 first-of-type:pt-0">
                  {/* With one network picked, its button already says this; the heading stays for screen readers. */}
                  <h3 id={id} className={active === 'all' ? 'flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold' : 'sr-only'}>
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: CARRIER_DOT[networkKey(g.carrier)] }} />
                    {networkName(g.carrier, t)}
                    <span className="text-sm font-normal text-muted-foreground">
                      {t('n.bh.notContacted', { count: g.notContacted })}
                      {g.noAnswer ? t('n.bh.noAnswer', { count: g.noAnswer }) : ''}
                    </span>
                  </h3>
                  <p className={cn('text-sm text-muted-foreground', active === 'all' && 'mt-0.5')}>
                    {g.carrier ? t('n.bh.useNetwork', { network: networkName(g.carrier, t) }) : t('n.bh.unknownPrefix')}
                  </p>
                  <ul className="mt-1 divide-y">
                    {g.lines.map((line) => (
                      <ByHandRow key={`${line.day}|${line.phone}`} line={line} data={data} />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
          {left > BY_HAND_SHOWN && (
            <Button variant="link" size="sm" className="mt-2 px-0" onClick={() => setAll(!all)}>
              {all ? t('n.day.fewer') : t('n.day.all', { count: left })}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

/** One network in the selector: how many are still to contact, and how many of those did not answer. */
function NetworkButton({ label, dot, left, noAnswer, pressed, onClick }: { label: string; dot?: string; left: number; noAnswer: number; pressed: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'flex min-h-11 flex-col items-start rounded-md border px-3 py-1.5 text-left text-sm transition-colors motion-reduce:transition-none',
        pressed ? 'border-primary bg-accent text-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      <span className="flex items-center gap-1.5 font-medium">
        {dot && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />}
        {label}
        <span className={cn('font-mono', left ? 'text-foreground' : 'text-success')}>{left || <Check className="size-3.5" aria-label={t('n.bh.done')} />}</span>
      </span>
      <span className="text-xs">
        {left === 0
          ? t('n.bh.allDone')
          : noAnswer
            ? t('n.bh.notContactedNoAnswer', { notContacted: left - noAnswer, noAnswer })
            : t('n.bh.notContacted', { count: left })}
      </span>
    </button>
  );
}

/**
 * One customer: the number to dial first and largest, the name under it, then Call, Telegram, SMS and Verify. Verify is
 * optional (owner, 2026-10-23): scan or type the parcel in hand to make sure it is this number's before contacting.
 */
function ByHandRow({ line, data }: { line: ByHandLine; data: ParcelData }) {
  const t = useT();
  const [open, setOpen] = useState(false); // phones: the row opens to show Call, Telegram, SMS and Verify
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<LineCheck | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const group = data.parcels.filter((p) => line.codes.includes(p.code));
  if (!group.length) return null;
  return (
    // A light highlight on the row under the mouse or being worked on; green once Verify confirmed the parcel.
    <li
      className={cn(
        'relative -mx-3 grid grid-cols-[minmax(0,1fr)] gap-x-6 rounded-md px-3 py-3 transition-colors motion-reduce:transition-none sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-y-2',
        open && 'gap-y-2',
        result?.kind === 'match' ? 'bg-success-tint' : 'hover:bg-secondary/60 focus-within:bg-secondary/60',
      )}
    >
      {/* Phones: tapping the row opens it; the chevron says so and is the keyboard and screen-reader way in. */}
      <div className="min-w-0 max-sm:cursor-pointer max-sm:pr-10" onClick={() => setOpen(!open)}>
        <p className="flex items-center gap-2">
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: CARRIER_DOT[networkKey(line.carrier)] }} />
          <span className="font-mono text-lg font-semibold tracking-tight tabular-nums">{formatPhone(line.phone)}</span>
          <span className="sr-only">, {networkName(line.carrier, t)}</span>
        </p>
        <p className="pl-4 text-sm">
          {line.recipient}
          <span className="text-muted-foreground">{t('n.bh.parcels', { count: line.codes.length })}</span>
        </p>
        <p className="truncate pl-4 font-mono text-xs text-muted-foreground">{line.codes.join(', ')}</p>
        {line.lastTry && (
          <p className="mt-0.5 flex items-center gap-1 pl-4 text-xs font-medium text-warning">
            <PhoneOff className="size-3.5" aria-hidden />
            {t('n.bh.noAnswerAt', { time: formatTime(line.lastTry) })}
            {line.tries > 1 && t('n.bh.tries', { count: line.tries })}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('n.bh.contactOrVerify', { phone: formatPhone(line.phone) })}
        onClick={() => setOpen(!open)}
        className="absolute top-2 right-1 grid size-11 place-items-center rounded-md text-muted-foreground sm:hidden"
      >
        <ChevronDown className={cn('size-5 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
      </button>
      <div className="sm:justify-self-end">
        <DirectContact
          actionsOpen={open}
          parcel={group[0]}
          group={group}
          events={data.events}
          message={line.message}
          stops={0}
          compact
          verifying={verifying}
          onVerify={() => {
            setVerifying(!verifying);
            setResult(null);
          }}
        />
      </div>
      {verifying && (
        <VerifyParcel
          line={line}
          parcels={data.parcels}
          checked={checked}
          result={result}
          onResult={(r) => {
            setResult(r);
            if (r.kind === 'match') setChecked((c) => [...new Set([...c, r.code])]);
          }}
          onClose={() => {
            setVerifying(false);
            setResult(null);
          }}
        />
      )}
    </li>
  );
}

/**
 * The row's check, camera only (owner, 2026-10-23): it opens straight into the camera, and after a scan shows whether
 * the parcel is this number's. Closing the camera before any scan closes the check.
 */
function VerifyParcel({
  line,
  parcels,
  checked,
  result,
  onResult,
  onClose,
}: {
  line: ByHandLine;
  parcels: ParcelData['parcels'];
  checked: string[];
  result: LineCheck | null;
  onResult: (r: LineCheck) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [camera, setCamera] = useState(true);
  const again = useRef<HTMLButtonElement>(null);
  return (
    <div className="sm:col-span-2">
      <div aria-live="polite" className="empty:hidden">
        {result?.kind === 'match' && (
          <p className="flex items-start gap-2 text-sm font-medium text-success">
            <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {t.rich('n.v.right', { code: <span className="font-mono">{result.code}</span> }, { phone: formatPhone(line.phone), recipient: line.recipient })}
              {line.codes.length > 1 && t('n.v.checked', { checked: result.checked, count: line.codes.length })}
            </span>
          </p>
        )}
        {result?.kind === 'other' && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive-tint px-3 py-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {t.rich(
                'n.v.isFor',
                {
                  label: <span className="font-semibold">{t('n.v.notThis')}</span>,
                  code: <span className="font-mono">{result.code}</span>,
                  phone: result.phone ? <span className="font-mono">{formatPhone(result.phone)}</span> : t('n.v.noNumber'),
                },
                { recipient: result.recipient },
              )}
            </span>
          </p>
        )}
        {result?.kind === 'not-found' && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive-tint px-3 py-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t.rich('n.v.notFound', { code: <span className="font-mono">{result.code}</span> })}</span>
          </p>
        )}
      </div>
      {result && (
        <div className="mt-2 flex items-center gap-2">
          <Button ref={again} type="button" variant="outline" size="sm" className="bg-card" onClick={() => setCamera(true)}>
            <Camera aria-hidden />
            {t('scan.again')}
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={t('n.v.close')} onClick={onClose}>
            <X aria-hidden />
          </Button>
        </div>
      )}
      <CameraScanner
        open={camera}
        onClose={() => {
          setCamera(false);
          if (!result) onClose(); // closed before any scan: nothing to show
        }}
        onDetected={(text) => {
          setCamera(false);
          onResult(verifyForLine(text, parcels, line, checked));
        }}
        returnFocus={again}
        typeInstead={false}
      />
    </div>
  );
}

/**
 * While a run goes (Phase 12, owner 2026-10-23): the browser tab says how far it is, a chime plays when it finishes,
 * and three beeps play when it needs someone, again every 30 seconds (at most 5 times) until someone clicks or types.
 * Sounds play only on a change seen with this page open, never on its first load.
 */
function RunAlerts({ data }: { data: ParcelData | null }) {
  const t = useT();
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
          ? t('n.title.attention', { title: base.current })
          : status === 'done'
            ? t('n.title.done', { title: base.current })
            : t(status === 'paused' ? 'n.title.paused' : 'n.title.sending', { done, total: batch.length, title: base.current });
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
