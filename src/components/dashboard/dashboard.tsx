'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CircleCheck, CircleDashed, CircleX, FileUp, FolderSearch, PhoneOff, QrCode as QrIcon, ScanBarcode, Send, type LucideIcon } from 'lucide-react';
import { SmsBadge } from '@/components/parcels/parcel-status';
import { batchLabel, daysAgo, GroupBadge, toNotifyLine } from '@/components/parcels/phone-group';
import { StatusBadge } from '@/components/import/status-badge';
import { QrCode } from '@/components/shared/qr-code';
import { SampleDataNotice } from '@/components/shared/sample-data-notice';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { dayProgress, workList, type DayProgress, type WorkGroup } from '@/lib/dashboard-logic';
import { getFolder, listImports, type ImportListItem } from '@/lib/import-api';
import { useParcelData, useParcelError } from '@/lib/parcel-service';
import { fetchBranchAddresses } from '@/lib/branch-address';
import { arrivalDay, formatPhone, type SmsStatus } from '@/lib/parcel-logic';
import { cn, formatDateTime } from '@/lib/utils';
import { formatDate } from '@/lib/i18n';
import { useT, type MessageKey } from '@/lib/i18n-react';

type T = ReturnType<typeof useT>;
const SHOWN = 4;
// Groups are per arrival batch; earlier batches say which day they came in.
const arrived = (day: string, t: T) => (daysAgo(day) === 0 ? '' : t('dash.arrivedOn', { day: batchLabel(day, t) }));
// Customers (phone lines) and parcels are counted separately, so "3" never means either.
const tally = (groups: { codes: string[] }[], t: T, unit: MessageKey = 'dash.customers') =>
  t('dash.tally', {
    groups: t(unit, { count: groups.length }),
    parcels: t('dash.parcels', { count: groups.reduce((n, g) => n + g.codes.length, 0) }),
  });

/** Today's work for the one staff member on shift: what needs doing, each item linked to where it gets done. */
export function Dashboard() {
  const t = useT();
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
  const today = formatDate(new Date(), t.locale, { weekday: 'long', day: 'numeric', month: 'long' }, []);

  return (
    <>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{today}</p>
          <h1 className="mt-0.5 text-[1.75rem] leading-tight font-semibold tracking-tight">{t('dash.title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('dash.lead')}</p>
        </div>
        {/* relative: the QR card hangs from this row's right edge, so it stays on screen when the buttons wrap. */}
        <div className="relative flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/scan?camera=1">
              <ScanBarcode aria-hidden />
              {t('nav.scan')}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/import-arrivals">
              <FileUp aria-hidden />
              {t('nav.importArrivals')}
            </Link>
          </Button>
          <PhoneQr />
        </div>
      </div>

      <SampleDataNotice>{t('dash.sampleNotice')}</SampleDataNotice>

      <TodayArrivals progress={data ? dayProgress(data.parcels, data.events, day) : null} error={parcelError} />

      {/* minmax(0, …) lets long code lists truncate instead of widening the column past a phone screen. */}
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Attention work={work} waiting={waiting} error={parcelError} />
        <ImportsToday records={imports} error={importError} />
      </div>
    </>
  );
}

/** This console's address as a QR code in a small card under its button, so a phone opens it with its camera. */
function PhoneQr() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  // A tap anywhere else closes it, as the profile card in the header does.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const toggle = () => {
    setOpen(!open);
    if (url !== undefined) return;
    // Phones reach the console at the Tailscale address; without one, this page's own address unless it is this computer's.
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    fetchBranchAddresses().then(({ secure }) => setUrl(secure ?? (local ? null : location.origin)));
  };
  return (
    <div ref={box} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <Button variant="outline" size="icon" onClick={toggle} aria-expanded={open} aria-controls="phone-qr" aria-label={t('dash.qr.show')} title={t('dash.qr.show')}>
        <QrIcon aria-hidden />
      </Button>
      {open && (
        <div
          id="phone-qr"
          role="dialog"
          aria-labelledby="phone-qr-heading"
          // Grows out of the button: starting: is the style it fades and scales in from.
          className="absolute top-full right-0 z-40 mt-2 w-[248px] origin-top-right rounded-md border bg-card p-4 shadow-lg transition duration-200 ease-out starting:scale-95 starting:opacity-0 motion-reduce:transition-none"
        >
          <h2 id="phone-qr-heading" className="font-semibold">
            {t('dash.qr.title')}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('dash.qr.lead')}</p>
          <div className="mt-3">
            {url === undefined ? (
              <Skeleton className="size-[200px]" />
            ) : url === null ? (
              <p className="rounded-md bg-secondary px-3 py-2.5 text-sm">{t('dash.qr.noAddress')}</p>
            ) : (
              <>
                <QrCode url={url} />
                <p className="mt-2 font-mono text-xs break-all">{url}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Most settled first, so the bar fills from the left as the day's work gets done. Icon and word on every state.
const STAGES: { key: keyof DayProgress; label: MessageKey; icon: LucideIcon; fill: string; ink: string }[] = [
  { key: 'done', label: 'dash.stage.done', icon: CircleCheck, fill: 'bg-success', ink: 'text-success' },
  { key: 'sending', label: 'dash.stage.sending', icon: Send, fill: 'bg-info', ink: 'text-info' },
  { key: 'retry', label: 'dash.stage.retry', icon: CircleX, fill: 'bg-destructive', ink: 'text-destructive' },
  { key: 'noPhone', label: 'dash.stage.noPhone', icon: PhoneOff, fill: 'bg-warning', ink: 'text-warning' },
  { key: 'notYet', label: 'dash.stage.notYet', icon: CircleDashed, fill: 'bg-muted-foreground/30', ink: 'text-muted-foreground' },
];

/** How far today's arrival batch has got: one stacked bar, with the counts spelled out beside it. */
function TodayArrivals({ progress, error }: { progress: DayProgress | null; error: string | null }) {
  const t = useT();
  const total = progress ? STAGES.reduce((n, s) => n + progress[s.key], 0) : 0;
  const shown = STAGES.filter((s) => progress && progress[s.key] > 0);

  return (
    <section aria-labelledby="arrivals-heading" className="mt-6 rounded-md border bg-card px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="arrivals-heading" className="text-base font-semibold">
          {t('dash.arrivals')}
        </h2>
        {progress && total > 0 && (
          <p className="text-sm text-muted-foreground">
            {t.rich('dash.progress', { done: <span className="font-medium text-foreground">{progress.done}</span> }, { count: total })}
          </p>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-destructive">
          {t('dash.parcelsFailed', { error })}
        </p>
      ) : !progress ? (
        <div className="mt-4 space-y-3" aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : total === 0 ? (
        <p className="mt-2 text-muted-foreground">
          {t.rich('dash.noneToday', {
            link: (
              <Link href="/import-arrivals" className="font-medium text-primary underline-offset-4 hover:underline">
                {t('nav.importArrivals')}
              </Link>
            ),
          })}
        </p>
      ) : (
        <>
          {/* Decorative: the list below carries every number, so screen readers read that instead. */}
          <div className="mt-4 flex h-3 gap-0.5" aria-hidden>
            {shown.map((s) => (
              <span key={s.key} className={cn('rounded-sm', s.fill)} style={{ flexGrow: progress[s.key] }} title={`${t(s.label)}: ${progress[s.key]}`} />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {STAGES.map((s) => (
              <li key={s.key} className={cn('flex items-center gap-1.5', progress[s.key] === 0 && 'text-muted-foreground')}>
                <s.icon className={cn('size-4', progress[s.key] > 0 ? s.ink : 'text-muted-foreground')} aria-hidden />
                <span className="font-mono font-medium">{progress[s.key]}</span>
                {t(s.label)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Attention({ work, waiting, error }: { work: ReturnType<typeof workList> | null; waiting: number | null; error: string | null }) {
  const t = useT();
  const loading = !work || waiting === null;
  const empty = !loading && !waiting && !work.retry.length && !work.toMessage.length && !work.noPhone.length;

  return (
    <section aria-labelledby="attention-heading" className="rounded-md border bg-card">
      <h2 id="attention-heading" className="px-5 pt-5 pb-3 text-base font-semibold">
        {t('dash.attention')}
      </h2>

      {error ? (
        <p role="alert" className="border-t px-5 py-4 text-sm text-destructive">
          {t('dash.workFailed')}
        </p>
      ) : loading ? (
        <div className="space-y-3 border-t px-5 py-5" aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
        </div>
      ) : empty ? (
        <div className="flex items-start gap-3 border-t px-5 py-8">
          <CircleCheck className="mt-0.5 size-5 text-success" aria-hidden />
          <div>
            <p className="font-medium">{t('dash.caughtUp')}</p>
            <p className="mt-0.5 text-muted-foreground">{t('dash.caughtUpLead')}</p>
          </div>
        </div>
      ) : (
        <div className="divide-y border-t">
          {waiting! > 0 && (
            <Block
              title={t('dash.folder.title')}
              count={t('dash.files', { count: waiting! })}
              hint={t('dash.folder.hint')}
              action={{ href: '/import-arrivals', label: t('dash.folder.action') }}
              icon={<FolderSearch className="size-4 text-info" aria-hidden />}
            />
          )}

          {work.retry.length > 0 && (
            <Block
              title={t('dash.stage.retry')}
              count={tally(work.retry.map((e) => ({ codes: e.parcelCodes })), t, 'dash.sms')}
              hint={t('dash.retry.hint')}
              action={{ href: '/notifications', label: t('dash.retry.action') }}
            >
              {work.retry.slice(0, SHOWN).map((e) => (
                <Item key={e.id} href="/notifications" title={formatPhone(e.phone)} codes={e.parcelCodes} codesLabel={t('sms.scope', { count: e.parcelCodes.length })}>
                  <SmsBadge status={e.smsStatus as SmsStatus} />
                </Item>
              ))}
            </Block>
          )}

          {work.toMessage.length > 0 && (
            <Block
              title={t('dash.stage.notYet')}
              count={tally(work.toMessage, t)}
              hint={t('dash.toMessage.hint')}
            >
              {work.toMessage.slice(0, SHOWN).map((g) => (
                <GroupItem key={`${g.day}|${g.phone}`} group={g} codesLabel={`${toNotifyLine(g.codes.length, g.size, t)}${arrived(g.day, t)}`} />
              ))}
              <More shown={SHOWN} total={work.toMessage.length} />
            </Block>
          )}

          {work.noPhone.length > 0 && (
            <Block
              title={t('dash.stage.noPhone')}
              count={t('dash.parcels', { count: work.noPhone.length })}
              hint={t('dash.noPhone.hint')}
              action={{ href: '/parcels?filter=no-phone', label: t('dash.noPhone.action') }}
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
          {t('dash.inFlight', { count: work.inFlight })}
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
  const t = useT();
  return (
    <li>
      <Link href={href} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 hover:bg-accent/60">
        {/* The basis lets the badge drop to its own line on a phone instead of squeezing the name. */}
        <span className="min-w-0 flex-1 basis-52">
          <span className="block font-medium">
            {title}
            {sub && <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">{sub}</span>}
          </span>
          {codesLabel && <span className="block text-xs text-muted-foreground">{t('dash.codesLabel', { label: codesLabel })}</span>}
          <span className="block truncate font-mono text-xs text-muted-foreground">{codes.join(', ')}</span>
        </span>
        {children}
      </Link>
    </li>
  );
}

const GroupItem = ({ group: g, codesLabel }: { group: WorkGroup; codesLabel: string }) => (
  <Item href={`/parcels?q=${encodeURIComponent(g.phone)}`} title={g.recipient} sub={formatPhone(g.phone)} codes={g.codes} codesLabel={codesLabel}>
    <GroupBadge size={g.size} />
  </Item>
);

function More({ shown, total }: { shown: number; total: number }) {
  const t = useT();
  return total > shown ? (
    <li className="px-3 py-2 text-sm text-muted-foreground">
      {t('dash.more', { count: total - shown })}{' '}
      <Link href="/parcels" className="font-medium text-primary underline-offset-4 hover:underline">
        {t('dash.seeAll')}
      </Link>
    </li>
  ) : null;
}

const confirmedToday = (r: ImportListItem) => r.status === 'imported' && !!r.confirmedAt && arrivalDay(r.confirmedAt) === arrivalDay(new Date().toISOString());

/** Today's confirmed files as one line: what came in, what the Shopee rule kept, and what was new. */
function ImportsToday({ records, error }: { records: ImportListItem[] | null; error: string | null }) {
  const t = useT();
  const today = records?.filter(confirmedToday) ?? [];
  const sum = (k: 'rowsTotal' | 'rowsShopee' | 'parcels' | 'added' | 'duplicates') => today.reduce((n, r) => n + r[k], 0);
  const steps: [MessageKey, number][] = [
    ['dash.step.rows', sum('rowsTotal')],
    ['dash.step.shopee', sum('rowsShopee')],
    ['dash.step.parcels', sum('parcels')],
    ['dash.step.new', sum('added')],
  ];
  const latest = records?.[0] ?? null;
  // Parcels that did not become new ones: already in the database, or left out (or held for another scan date) in review.
  const leftOut = sum('parcels') - sum('added') - sum('duplicates');
  const skipped = [
    sum('duplicates') > 0 && t('dash.alreadyStored', { count: sum('duplicates') }),
    leftOut > 0 && t('dash.leftOut', { count: leftOut }),
  ].filter(Boolean);

  return (
    <section aria-labelledby="imports-heading" className="rounded-md border bg-card">
      <div className="flex items-baseline justify-between gap-3 px-5 pt-5 pb-3">
        <h2 id="imports-heading" className="text-base font-semibold">
          {t('dash.importsToday')}
          {records && <span className="ml-2 text-sm font-normal text-muted-foreground">{t('dash.files', { count: today.length })}</span>}
        </h2>
        <Link href="/import-arrivals" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          {t('nav.importArrivals')}
        </Link>
      </div>
      {error ? (
        <p role="alert" className="border-t px-5 py-4 text-sm text-destructive">
          {t('dash.importsFailed', { error })}
        </p>
      ) : (
        <>
          {/* Each step keeps part of the one before it, so the line reads left to right as the file narrows down. */}
          <ol className="grid grid-cols-2 border-y sm:grid-cols-4">
            {steps.map(([label, n], i) => (
              // Numbers sit on one line even when a label wraps (Khmer labels run longer).
              <li key={label} className={cn('flex flex-col justify-between px-4 py-3', i % 2 === 1 && 'border-l', i >= 2 && 'border-t sm:border-t-0', i === 2 && 'sm:border-l')}>
                <span className="block text-xs text-muted-foreground">{t(label)}</span>
                <span className={cn('mt-0.5 block font-mono text-xl font-medium', i === 3 && today.length > 0 && 'text-success')}>
                  {records ? n : <Skeleton className="mt-1 h-7 w-10" />}
                </span>
              </li>
            ))}
          </ol>
          {records && skipped.length > 0 && <p className="border-b px-5 py-2 text-sm text-muted-foreground">{t('dash.notAdded', { list: skipped.join(' · ') })}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
            {!records ? (
              <Skeleton className="h-5 w-full" />
            ) : !latest ? (
              <span className="text-muted-foreground">{t('dash.noImports')}</span>
            ) : (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">
                    {t.rich('dash.latest', {
                      time: (
                        <time dateTime={latest.confirmedAt ?? latest.checkedAt} className="font-mono">
                          {formatDateTime(latest.confirmedAt ?? latest.checkedAt, t.locale)}
                        </time>
                      ),
                    })}
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
