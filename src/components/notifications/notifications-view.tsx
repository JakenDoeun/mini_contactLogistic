'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronRight, CircleCheck, MessageSquare, Pause, Phone, PhoneOff, Play, RotateCcw, Search, Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ParcelDetail } from '@/components/parcels/parcel-detail';
import { SmsBadge } from '@/components/parcels/parcel-status';
import { batchLabel } from '@/components/parcels/phone-group';
import { DateFilter } from '@/components/shared/date-filter';
import { planNotify, workList, type NotifyItem } from '@/lib/dashboard-logic';
import { ANY_DATE, inDateRange, isAnyDate, rangePhrase, type DateRange } from '@/lib/date-range';
import {
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
import { controlBatch, dismissBatch, queueBatch, queueSms, useParcelData, type ParcelData, type SmsBatch } from '@/lib/parcel-service';
import { getSettings } from '@/lib/mock/settings-service';
import { useSettings } from '@/lib/mock/use-settings';
import { cn, formatDateTime } from '@/lib/utils';

type ChannelFilter = 'all' | 'sms' | 'call' | 'telegram';
const CHANNEL_FILTERS: { key: ChannelFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sms', label: 'SMS' },
  { key: 'call', label: 'Calls' },
  { key: 'telegram', label: 'Telegram' },
];

const CHANNEL: Record<Channel, { label: string; icon: typeof Send }> = {
  sms: { label: 'SMS', icon: Send },
  call: { label: 'Call', icon: Phone },
  telegram: { label: 'Telegram', icon: MessageSquare },
};
const OUTCOME = { answered: 'Reached customer', 'no-answer': 'No answer', messaged: 'Sent on Telegram' };

const waiting = (e: ContactEvent) => e.smsStatus === 'queued' || e.smsStatus === 'sending';
const PAGE = 10;
const READY_SHOWN = 6;

export function NotificationsView({ initialFilter }: { initialFilter?: string }) {
  const data = useParcelData();
  const templates = useSettings()?.templates;
  const [retrying, setRetrying] = useState<ContactEvent | null>(null);
  /** A parcel code; its detail, with the contact panel and phone field, opens in a drawer. */
  const [contacting, setContacting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const events = data ? [...data.events].sort((a, b) => b.at.localeCompare(a.at)) : null;
  const work = data ? workList(data.parcels, data.events) : null;
  const plan = data ? planNotify(data.parcels, data.events, new Date(), templates) : null;
  const nameOf = (code: string) => data?.parcels.find((p) => p.code === code)?.recipient ?? '';
  const contactParcel = data?.parcels.find((p) => p.code === contacting);
  const running = !!data?.batch && (data.batch.status === 'running' || data.batch.status === 'paused');

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-muted-foreground">Fix what went wrong, send today&apos;s messages in one go, and look back at what was sent.</p>
        </div>
      </div>

      {/* Urgency sets the size: attention leads, the live queue follows, ready-to-send supports from the side. */}
      <div className="mt-7 grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <Attention work={work} events={events} nameOf={nameOf} onRetry={setRetrying} onOpen={setContacting} />
          <SendingQueue data={data} nameOf={nameOf} running={running} />
        </div>
        <Ready plan={plan} running={running} onNotify={() => setConfirming(true)} />
      </div>

      <History events={events} data={data} nameOf={nameOf} initialChannel={initialFilter} />

      <RetrySheet event={retrying} data={data} onClose={() => setRetrying(null)} />
      <ConfirmNotify open={confirming} data={data} templates={templates} onClose={() => setConfirming(false)} />

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
          hint="Handed to the gateway phone one at a time. Accepted messages move to History; failed or unconfirmed ones move to Needs your attention."
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
                : running
                  ? `Sending ${Math.min(done + 1, batch.length)} of ${batch.length}…`
                  : data.batch?.status === 'stopped'
                    ? `Stopped: ${batch.length - tally('not-sent')} of ${batch.length} handed over`
                    : `Finished: ${batch.length} SMS`}
            </span>
            <span className="text-muted-foreground">
              {tally('sent') + tally('delivered')} sent · {tally('failed')} failed · {tally('unconfirmed')} unconfirmed
              {running && ` · ${batch.length - done} to go`}
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
        </div>
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
function Ready({ plan, running, onNotify }: { plan: ReturnType<typeof planNotify> | null; running: boolean; onNotify: () => void }) {
  const parcels = plan?.today.reduce((n, i) => n + i.codes.length, 0) ?? 0;
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
          <Button className="mt-4 w-full" onClick={onNotify} disabled={running || plan.today.length === 0}>
            <Send aria-hidden />
            Notify today&apos;s customers
          </Button>
          {running && <p className="mt-2 text-xs text-muted-foreground">A run is in progress. Start the next one when it finishes.</p>}

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
        </>
      )}
    </aside>
  );
}

/** Messages grouped by arrival day, newest day first. */
function byDay(items: NotifyItem[]) {
  const days = new Map<string, NotifyItem[]>();
  for (const i of items) days.set(i.day, [...(days.get(i.day) ?? []), i]);
  return [...days].sort(([a], [b]) => b.localeCompare(a));
}

const DAY_SHOWN = 5;

/** One arrival day in the run: today opens, earlier days stay one line until opened, and each shows its first few. */
function DayMessages({ day, items }: { day: string; items: NotifyItem[] }) {
  const [all, setAll] = useState(false);
  const label = batchLabel(day);
  const parcels = items.reduce((n, i) => n + i.codes.length, 0);
  const shown = all ? items : items.slice(0, DAY_SHOWN);
  return (
    <details open={label === 'today'} className="group">
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
              <span className="text-xs text-muted-foreground">{smsScope(i.codes.length)}</span>
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

/** The one confirmation for a whole run. The plan is worked out from the live records, so nothing stale is sent. */
function ConfirmNotify({
  open,
  data,
  templates,
  onClose,
}: {
  open: boolean;
  data: ParcelData | null;
  templates: Parameters<typeof planNotify>[3];
  onClose: () => void;
}) {
  // One key per opening of the dialog: a second click or a retried request finds the batch and creates nothing.
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const plan = data ? planNotify(data.parcels, data.events, new Date(), templates) : null;
  const items: NotifyItem[] = plan?.today ?? [];
  const parcels = items.reduce((n, i) => n + i.codes.length, 0);
  const combined = items.filter((i) => i.codes.length > 1).length;
  const close = () => {
    setRequestKey(crypto.randomUUID());
    setError('');
    onClose();
  };
  async function start() {
    setStarting(true);
    setError('');
    try {
      await queueBatch(requestKey, items);
      close();
    } catch (e) {
      setError(`Not started. ${(e as Error).message}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent>
        {plan && (
          <>
            <header className="border-b px-6 pt-5 pb-4 pr-14">
              <SheetTitle>Notify today&apos;s customers?</SheetTitle>
              <SheetDescription>The gateway phone sends them one at a time, from the branch SIM.</SheetDescription>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <dl className="grid grid-cols-3 gap-3">
                {(
                  [
                    ['Customers', items.length],
                    ['Parcels', parcels],
                    ['SMS', items.length],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="font-mono text-2xl font-medium">{n}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-sm text-muted-foreground">
                {combined} combined, {items.length - combined} individual. One SMS per phone number. Parcels already notified are left out.
              </p>
              {plan.noPhoneToday.length > 0 && (
                <p className="mt-3 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
                  {plan.noPhoneToday.length === 1 ? "1 of today's parcels has no phone number and is" : `${plan.noPhoneToday.length} of today's parcels have no phone number and are`}{' '}
                  skipped. They are listed under Needs your attention.
                </p>
              )}
              <h3 className="mt-5 text-sm font-medium">
                {items.length === 1 ? '1 message' : `${items.length} messages`} to send
              </h3>
              <div className="mt-2 divide-y rounded-md border">
                {byDay(items).map(([day, list]) => (
                  <DayMessages key={day} day={day} items={list} />
                ))}
              </div>
            </div>
            {/* Outside the scrolling list, so Start queue stays in view however many customers there are. */}
            <footer className="flex flex-wrap items-center gap-2 border-t px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Button disabled={items.length === 0 || starting} onClick={start}>
                <Send aria-hidden />
                {starting ? 'Starting…' : `Start queue (${items.length} SMS)`}
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
    <section aria-labelledby="log-heading" className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Heading id="log-heading" title="History" hint="Every SMS, call and Telegram message. A combined SMS is one entry." />
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
  if (e.channel === 'sms') return e.parcelCodes.length > 1 ? `Combined SMS · ${e.parcelCodes.length} parcels` : 'SMS';
  if (!e.outcome) return CHANNEL[e.channel].label;
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
    setText(event.message || composeMessage(name, event.parcelCodes, getSettings().templates));
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
