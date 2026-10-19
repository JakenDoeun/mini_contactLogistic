'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, CircleCheck, CircleDashed, CircleX, FileUp, FolderSearch, PhoneOff, ScanBarcode, Send, type LucideIcon } from 'lucide-react';
import { ContactBadge, SmsBadge } from '@/components/parcels/parcel-status';
import { batchLabel, GroupBadge, toNotifyLine } from '@/components/parcels/phone-group';
import { StatusBadge } from '@/components/import/status-badge';
import { SampleDataNotice } from '@/components/shared/sample-data-notice';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { dayProgress, workList, type DayProgress, type WorkGroup } from '@/lib/dashboard-logic';
import { getFolder, listImports, type ImportListItem } from '@/lib/import-api';
import { useParcelData, useParcelError } from '@/lib/mock/parcel-service';
import { arrivalDay, formatPhone, smsScope, type ContactStatus, type SmsStatus } from '@/lib/parcel-logic';
import { cn, formatDateTime } from '@/lib/utils';

const SHOWN = 4;
// Groups are per arrival batch; earlier batches say which day they came in.
const arrived = (day: string) => (batchLabel(day) === 'today' ? '' : ` · arrived ${batchLabel(day)}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 || word === 'SMS' ? '' : 's'}`;
// Customers (phone lines) and parcels are counted separately, so "3" never means either.
const tally = (groups: { codes: string[] }[], unit = 'customer') =>
  `${plural(groups.length, unit)} · ${plural(groups.reduce((n, g) => n + g.codes.length, 0), 'parcel')}`;

/** Today's work for the one staff member on shift: what needs doing, each item linked to where it gets done. */
export function Dashboard() {
  const data = useParcelData();
  const parcelError = useParcelError();
  const [imports, setImports] = useState<ImportListItem[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);

  useEffect(() => {
    listImports().then(setImports, (e: Error) => setImportError(e.message));
    // Same rule as the folder panel on Import Arrivals: found, not yet opened for review.
    getFolder().then((f) => setWaiting(f.files.filter((x) => x.state === 'waiting' && !x.importStatus).length), () => setWaiting(0));
  }, []);

  const work = data ? workList(data.parcels, data.events) : null;
  const day = arrivalDay(new Date().toISOString());
  const today = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{today}</p>
          <h1 className="mt-0.5 text-[1.75rem] leading-tight font-semibold tracking-tight">Today at Campus Branch</h1>
          <p className="mt-1 text-muted-foreground">What needs you now. Each item opens the page where it gets done.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/scan?camera=1">
              <ScanBarcode aria-hidden />
              Scan Parcel
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/import-arrivals">
              <FileUp aria-hidden />
              Import Arrivals
            </Link>
          </Button>
        </div>
      </div>

      <SampleDataNotice>Parcels and imports are real. Messages and calls are not saved yet, and no SMS leaves this device.</SampleDataNotice>

      <TodayArrivals progress={data ? dayProgress(data.parcels, data.events, day) : null} error={parcelError} />

      {/* minmax(0, …) lets long code lists truncate instead of widening the column past a phone screen. */}
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Attention work={work} waiting={waiting} error={parcelError} />
        <ImportsToday records={imports} error={importError} />
      </div>
    </>
  );
}

// Most settled first, so the bar fills from the left as the day's work gets done. Icon and word on every state.
const STAGES: { key: keyof DayProgress; label: string; icon: LucideIcon; fill: string; ink: string }[] = [
  { key: 'done', label: 'Messaged or reached', icon: CircleCheck, fill: 'bg-success', ink: 'text-success' },
  { key: 'sending', label: 'At the gateway', icon: Send, fill: 'bg-info', ink: 'text-info' },
  { key: 'retry', label: 'SMS to retry', icon: CircleX, fill: 'bg-destructive', ink: 'text-destructive' },
  { key: 'noPhone', label: 'No phone number', icon: PhoneOff, fill: 'bg-warning', ink: 'text-warning' },
  { key: 'notYet', label: 'Not messaged yet', icon: CircleDashed, fill: 'bg-muted-foreground/30', ink: 'text-muted-foreground' },
];

/** How far today's arrival batch has got: one stacked bar, with the counts spelled out beside it. */
function TodayArrivals({ progress, error }: { progress: DayProgress | null; error: string | null }) {
  const total = progress ? STAGES.reduce((n, s) => n + progress[s.key], 0) : 0;
  const shown = STAGES.filter((s) => progress && progress[s.key] > 0);

  return (
    <section aria-labelledby="arrivals-heading" className="mt-6 rounded-md border bg-card px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="arrivals-heading" className="text-base font-semibold">
          Today&apos;s arrivals
        </h2>
        {progress && total > 0 && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{progress.done}</span> of {plural(total, 'parcel')} messaged or reached
          </p>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-destructive">
          The parcel list could not be loaded. {error}
        </p>
      ) : !progress ? (
        <div className="mt-4 space-y-3" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : total === 0 ? (
        <p className="mt-2 text-muted-foreground">
          No parcels have arrived today yet. They show here once the morning&apos;s file is confirmed in{' '}
          <Link href="/import-arrivals" className="font-medium text-primary underline-offset-4 hover:underline">
            Import Arrivals
          </Link>
          .
        </p>
      ) : (
        <>
          {/* Decorative: the list below carries every number, so screen readers read that instead. */}
          <div className="mt-4 flex h-3 gap-0.5" aria-hidden>
            {shown.map((s) => (
              <span key={s.key} className={cn('rounded-sm', s.fill)} style={{ flexGrow: progress[s.key] }} title={`${s.label}: ${progress[s.key]}`} />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {STAGES.map((s) => (
              <li key={s.key} className={cn('flex items-center gap-1.5', progress[s.key] === 0 && 'text-muted-foreground')}>
                <s.icon className={cn('size-4', progress[s.key] > 0 ? s.ink : 'text-muted-foreground')} aria-hidden />
                <span className="font-mono font-medium">{progress[s.key]}</span>
                {s.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Attention({ work, waiting, error }: { work: ReturnType<typeof workList> | null; waiting: number | null; error: string | null }) {
  const loading = !work || waiting === null;
  const empty = !loading && !waiting && !work.retry.length && !work.toMessage.length && !work.followUp.length && !work.noPhone.length;

  return (
    <section aria-labelledby="attention-heading" className="rounded-md border bg-card">
      <h2 id="attention-heading" className="px-5 pt-5 pb-3 text-base font-semibold">
        Needs your attention
      </h2>

      {error ? (
        <p role="alert" className="border-t px-5 py-4 text-sm text-destructive">
          The work list needs the parcel list, which could not be loaded. Reload the page to try again.
        </p>
      ) : loading ? (
        <div className="space-y-3 border-t px-5 py-5" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
        </div>
      ) : empty ? (
        <div className="flex items-start gap-3 border-t px-5 py-8">
          <CircleCheck className="mt-0.5 size-5 text-success" aria-hidden />
          <div>
            <p className="font-medium">All caught up</p>
            <p className="mt-0.5 text-muted-foreground">No files to review, no messages to send or retry, no follow-ups and no missing phone numbers.</p>
          </div>
        </div>
      ) : (
        <div className="divide-y border-t">
          {waiting! > 0 && (
            <Block
              title="Folder files to review"
              count={plural(waiting!, 'file')}
              hint="Found in the watched folder. They are not imported until you review and confirm them."
              action={{ href: '/import-arrivals', label: 'Review in Import Arrivals' }}
              icon={<FolderSearch className="size-4 text-info" aria-hidden />}
            />
          )}

          {work.retry.length > 0 && (
            <Block
              title="SMS to retry"
              count={tally(work.retry.map((e) => ({ codes: e.parcelCodes })), 'SMS')}
              hint="The gateway rejected these, or never confirmed delivery. Retry, or call instead."
              action={{ href: '/notifications', label: 'Open in Notifications' }}
            >
              {work.retry.slice(0, SHOWN).map((e) => (
                <Item key={e.id} href="/notifications" title={formatPhone(e.phone)} codes={e.parcelCodes} codesLabel={smsScope(e.parcelCodes.length)}>
                  <SmsBadge status={e.smsStatus as SmsStatus} />
                </Item>
              ))}
            </Block>
          )}

          {work.toMessage.length > 0 && (
            <Block
              title="Not messaged yet"
              count={tally(work.toMessage)}
              hint="Arrived parcels nobody has told the customer about. One message covers every parcel on a phone that is not notified yet."
            >
              {work.toMessage.slice(0, SHOWN).map((g) => (
                <GroupItem key={`${g.day}|${g.phone}`} group={g} codesLabel={`${toNotifyLine(g.codes.length, g.size)}${arrived(g.day)}`} />
              ))}
              <More shown={SHOWN} total={work.toMessage.length} />
            </Block>
          )}

          {work.followUp.length > 0 && (
            <Block
              title="Follow-up needed"
              count={tally(work.followUp)}
              hint="Marked for follow-up, or called twice without an answer. Stays here until someone reaches the customer."
              action={{ href: '/parcels?filter=follow-up', label: 'Open in Parcels' }}
            >
              {work.followUp.slice(0, SHOWN).map((g) => (
                <GroupItem key={`${g.day}|${g.phone}`} group={g} status="follow-up" codesLabel={`Follow-up${arrived(g.day)}`} />
              ))}
              <More shown={SHOWN} total={work.followUp.length} />
            </Block>
          )}

          {work.noPhone.length > 0 && (
            <Block
              title="No phone number"
              count={plural(work.noPhone.length, 'parcel')}
              hint="The export had no usable number. Add one so the customer can be messaged; until then these are left out of messages."
              action={{ href: '/parcels?filter=no-phone', label: 'Add phones in Parcels' }}
            >
              {work.noPhone.slice(0, SHOWN).map((p) => (
                <Item key={p.code} href={`/parcels?q=${p.code}`} title={p.recipient} codes={[p.code]} />
              ))}
              <More shown={SHOWN} total={work.noPhone.length} />
            </Block>
          )}
        </div>
      )}

      {work && work.inFlight > 0 && (
        <p className="border-t px-5 py-3 text-sm text-muted-foreground">
          {plural(work.inFlight, 'SMS')} waiting at the gateway. Those parcels are left out above so nobody gets the same message twice.
        </p>
      )}
    </section>
  );
}

function Block({
  title,
  count,
  hint,
  action,
  icon,
  children,
}: {
  title: string;
  count: string;
  hint: string;
  action?: { href: string; label: string };
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="flex items-center gap-2 font-semibold">
          {icon}
          {title}
          <span className="text-sm font-normal text-muted-foreground">{count}</span>
        </h3>
        {action && (
          <Link href={action.href} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline sm:min-h-8">
            {action.label}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{hint}</p>
      {children && <ul className="mt-2 divide-y rounded-md border">{children}</ul>}
    </div>
  );
}

function Item({
  href,
  title,
  sub,
  codes,
  codesLabel,
  children,
}: {
  href: string;
  title: string;
  sub?: string;
  codes: string[];
  /** Names what the listed codes are, e.g. "2 of 3 still need notification". */
  codesLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <li>
      <Link href={href} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 hover:bg-accent/60">
        {/* The basis lets the badge drop to its own line on a phone instead of squeezing the name. */}
        <span className="min-w-0 flex-1 basis-52">
          <span className="block font-medium">
            {title}
            {sub && <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">{sub}</span>}
          </span>
          {codesLabel && <span className="block text-xs text-muted-foreground">{codesLabel}:</span>}
          <span className="block truncate font-mono text-xs text-muted-foreground">{codes.join(', ')}</span>
        </span>
        {children}
      </Link>
    </li>
  );
}

const GroupItem = ({ group: g, status, codesLabel }: { group: WorkGroup; status?: ContactStatus; codesLabel: string }) => (
  <Item href={`/parcels?q=${encodeURIComponent(g.phone)}`} title={g.recipient} sub={formatPhone(g.phone)} codes={g.codes} codesLabel={codesLabel}>
    <span className="flex flex-wrap gap-1.5">
      <GroupBadge size={g.size} />
      {status && <ContactBadge status={status} />}
    </span>
  </Item>
);

const More = ({ shown, total }: { shown: number; total: number }) =>
  total > shown ? (
    <li className="px-3 py-2 text-sm text-muted-foreground">
      and {total - shown} more.{' '}
      <Link href="/parcels" className="font-medium text-primary underline-offset-4 hover:underline">
        See all parcels
      </Link>
    </li>
  ) : null;

const confirmedToday = (r: ImportListItem) => r.status === 'imported' && !!r.confirmedAt && arrivalDay(r.confirmedAt) === arrivalDay(new Date().toISOString());

/** Today's confirmed files as one line: what came in, what the Shopee rule kept, and what was new. */
function ImportsToday({ records, error }: { records: ImportListItem[] | null; error: string | null }) {
  const today = records?.filter(confirmedToday) ?? [];
  const sum = (k: 'rowsTotal' | 'rowsShopee' | 'parcels' | 'added' | 'duplicates') => today.reduce((n, r) => n + r[k], 0);
  const steps: [string, number][] = [
    ['Rows in file', sum('rowsTotal')],
    ['Shopee rows', sum('rowsShopee')],
    ['Parcels', sum('parcels')],
    ['New', sum('added')],
  ];
  const latest = records?.[0] ?? null;
  // Parcels that did not become new ones: already in the database, or left out (or held for another scan date) in review.
  const leftOut = sum('parcels') - sum('added') - sum('duplicates');
  const skipped = [sum('duplicates') > 0 && `${sum('duplicates')} already stored`, leftOut > 0 && `${leftOut} left out in review`].filter(Boolean);

  return (
    <section aria-labelledby="imports-heading" className="rounded-md border bg-card">
      <div className="flex items-baseline justify-between gap-3 px-5 pt-5 pb-3">
        <h2 id="imports-heading" className="text-base font-semibold">
          Imports today
          {records && <span className="ml-2 text-sm font-normal text-muted-foreground">{plural(today.length, 'file')}</span>}
        </h2>
        <Link href="/import-arrivals" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Import Arrivals
        </Link>
      </div>
      {error ? (
        <p role="alert" className="border-t px-5 py-4 text-sm text-destructive">
          The import history could not be loaded. {error}
        </p>
      ) : (
        <>
          {/* Each step keeps part of the one before it, so the line reads left to right as the file narrows down. */}
          <ol className="grid grid-cols-2 border-y sm:grid-cols-4">
            {steps.map(([label, n], i) => (
              <li key={label} className={cn('px-4 py-3', i % 2 === 1 && 'border-l', i >= 2 && 'border-t sm:border-t-0', i === 2 && 'sm:border-l')}>
                <span className="block text-xs text-muted-foreground">{label}</span>
                <span className={cn('mt-0.5 block font-mono text-xl font-medium', i === 3 && today.length > 0 && 'text-success')}>
                  {records ? n : <Skeleton className="mt-1 h-7 w-10" />}
                </span>
              </li>
            ))}
          </ol>
          {records && skipped.length > 0 && <p className="border-b px-5 py-2 text-sm text-muted-foreground">Not added: {skipped.join(' · ')}.</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
            {!records ? (
              <Skeleton className="h-5 w-full" />
            ) : !latest ? (
              <span className="text-muted-foreground">No imports yet.</span>
            ) : (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">
                    Latest ·{' '}
                    <time dateTime={latest.confirmedAt ?? latest.checkedAt} className="font-mono">
                      {formatDateTime(latest.confirmedAt ?? latest.checkedAt)}
                    </time>
                  </span>
                  <span className="block truncate font-mono" title={latest.fileName}>
                    {latest.fileName}
                  </span>
                </span>
                <StatusBadge status={latest.status} />
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
