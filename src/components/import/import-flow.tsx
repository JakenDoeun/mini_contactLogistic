'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CircleCheck, FileSpreadsheet, Loader, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PhoneText } from '@/components/parcels/parcel-status';
import { CarrierChips } from '@/components/shared/carrier-chips';
import { phoneKey } from '@/lib/parcel-logic';
import { useParcelData } from '@/lib/parcel-service';
import {
  cancelImport,
  checkFile,
  checkFolderFile,
  confirmImport,
  decide,
  getReview,
  type DateChoice,
  type DetectedFile,
  type ImportListItem,
  type Review,
  type ReviewItem,
} from '@/lib/import-api';
import { cn, formatBytes, formatDateTime } from '@/lib/utils';
import { StatusBadge } from './status-badge';
import { useT, type MessageKey } from '@/lib/i18n-react';

/** What opened the sheet: a file staff just chose, one found in the watched folder, or an import from the history. */
export type FlowRequest = { kind: 'file'; file: File } | { kind: 'folder'; file: DetectedFile } | { kind: 'open'; id: number };

type Step = { s: 'loading'; text: string } | { s: 'error'; message: string } | { s: 'review'; review: Review; added?: number };

const PARCEL_STATE = {
  ready: { label: 'flow.state.new', variant: 'success' },
  blocked: { label: 'flow.state.blocked', variant: 'warning' },
  left_out: { label: 'flow.state.leftOut', variant: 'neutral' },
  db_duplicate: { label: 'flow.state.duplicate', variant: 'neutral' },
} as const;

const CLOSED: Record<string, MessageKey> = {
  imported: 'flow.closed.imported',
  failed: 'flow.closed.failed',
  cancelled: 'flow.closed.cancelled',
  no_eligible_rows: 'flow.closed.noShopee',
};

export function ImportFlow({ request, onClose, onChanged }: { request: FlowRequest | null; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const [step, setStep] = useState<Step | null>(null);
  const [choice, setChoice] = useState<DateChoice | null>(null);
  // The Arrival Batch Date: 'today', 'other' (the date field), or a scan date offered as-is. Null: not chosen yet.
  const [batchPick, setBatchPick] = useState<string | null>(null);
  const [otherDate, setOtherDate] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const run = useRef(0); // a closed or restarted flow ignores late results
  const heading = useRef<HTMLHeadingElement>(null);

  const review = step?.s === 'review' ? step.review : null;
  const live = !!review?.live;

  async function load(id: number, nextChoice: DateChoice | null, added?: number) {
    const r = run.current;
    const fresh = await getReview(id, nextChoice);
    if (r === run.current) setStep({ s: 'review', review: fresh, added });
  }

  async function start(req: FlowRequest) {
    const r = ++run.current;
    setChoice(null);
    setBatchPick(null);
    setOtherDate('');
    setActionError(null);
    try {
      let id: number;
      if (req.kind === 'file') {
        setStep({ s: 'loading', text: t('flow.checking', { file: req.file.name }) });
        id = (await checkFile(req.file)).importId;
        onChanged(); // a failed check is history too
      } else if (req.kind === 'folder') {
        setStep({ s: 'loading', text: t('flow.checking', { file: req.file.fileName }) });
        id = (await checkFolderFile(req.file.id)).importId;
        onChanged();
      } else {
        setStep({ s: 'loading', text: t('flow.opening') });
        id = req.id;
      }
      if (r !== run.current) return;
      const first = await getReview(id, null);
      if (r !== run.current) return;
      // One scan date and no partial re-review: there is nothing to choose.
      const initial: DateChoice | null = first.live && !first.dateChoiceNeeded && first.rerunOf === null ? { kind: 'single_scan_date' } : null;
      setChoice(initial);
      setBatchPick(first.scanDateDiffers ? null : 'today');
      setOtherDate(first.today);
      if (initial) await load(id, initial);
      else setStep({ s: 'review', review: first });
    } catch (e) {
      if (r === run.current) setStep({ s: 'error', message: (e as Error).message });
    }
  }

  useEffect(() => {
    if (!request) {
      run.current++;
      setStep(null);
      return;
    }
    start(request);
    // Each new request starts the flow over.
  }, [request]);

  // Each step replaces the buttons that were just pressed, so move focus to the new step's heading.
  useEffect(() => {
    heading.current?.focus();
  }, [step?.s, review?.status]);

  /** Run one action against the open import, then show its review as it now stands. */
  async function act(label: string, action: () => Promise<unknown>, after: (r: Review) => Promise<void> | void) {
    if (!review) return;
    setBusy(label);
    setActionError(null);
    try {
      await action();
      await after(review);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const arrivalBatchDate = !review ? '' : batchPick === 'today' ? review.today : batchPick === 'other' ? otherDate : (batchPick ?? '');
  const notYet = [
    ...(review?.refusals ?? []),
    ...(live && batchPick === null ? [t('flow.chooseBatch')] : []),
    ...(live && batchPick === 'other' && !/^\d{4}-\d{2}-\d{2}$/.test(otherDate) ? [t('flow.enterBatch')] : []),
  ];
  const ready = review?.counts.ready ?? 0;

  const h = (text: string) => (
    <h3 ref={heading} tabIndex={-1} className="text-base font-semibold outline-none">
      {text}
    </h3>
  );

  return (
    <Sheet open={!!request} onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent className="max-w-2xl" onEscapeKeyDown={(e) => busy && e.preventDefault()}>
        <header className="border-b px-6 pt-5 pb-4 pr-14">
          <SheetTitle>{review && !live ? t('flow.details') : t('flow.review')}</SheetTitle>
          <SheetDescription>{t('flow.lead')}</SheetDescription>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step?.s === 'loading' && (
            <p role="status" className="flex items-center gap-2 text-muted-foreground">
              <Loader className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              {step.text}
            </p>
          )}

          {step?.s === 'error' && <Problem heading={h(t('flow.wrong'))} message={step.message} />}

          {review && (
            <>
              {step?.s === 'review' && step.added !== undefined ? (
                <div className="mb-5 rounded-md bg-success-tint p-4">
                  <div className="flex items-start gap-2 text-success">
                    <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
                    {h(t('flow.imported', { count: step.added }))}
                  </div>
                  <p className="mt-1 pl-7">{t('flow.batchIs', { date: review.arrivalBatchDate ?? '' })}</p>
                </div>
              ) : live ? (
                h(t('flow.check'))
              ) : (
                h(CLOSED[review.status] ? t(CLOSED[review.status]) : review.status)
              )}

              <div className="mt-3">
                <FileFacts review={review} />
              </div>

              {review.status === 'failed' && (
                <div role="alert" className="mt-4 rounded-md bg-destructive-tint p-4 text-destructive">
                  <p>{review.error?.message}</p>
                  <p className="mt-2 text-foreground">{t('flow.fixExport')}</p>
                </div>
              )}

              {review.status !== 'failed' && <Counts review={review} />}

              {live && review.earlier.length > 0 && <EarlierImports review={review} />}

              {live && (
                <Decisions
                  items={review.items.filter((i) => i.kind === 'recipient_conflict' || i.kind === 'code_spelling')}
                  parcels={review.parcels}
                  disabled={!!busy}
                  onDecide={(item, decision) =>
                    act(`item-${item.id}`, () => decide(item.id, decision), (r) => load(r.id, choice))
                  }
                />
              )}

              {live && (
                <ScanDates
                  review={review}
                  choice={choice}
                  disabled={!!busy}
                  onChoose={(c) => {
                    setChoice(c);
                    act('choice', async () => {}, (r) => load(r.id, c));
                  }}
                />
              )}

              {live && (
                <BatchDate
                  review={review}
                  pick={batchPick}
                  otherDate={otherDate}
                  disabled={!!busy}
                  onPick={setBatchPick}
                  onOtherDate={(d) => {
                    setOtherDate(d);
                    setBatchPick('other');
                  }}
                />
              )}

              {review.status === 'imported' && review.arrivalBatchDate && step?.s === 'review' && step.added === undefined && (
                <p className="mt-4">
                  {t.rich('flow.importedAt', {
                    time: <time dateTime={review.confirmedAt ?? undefined}>{review.confirmedAt && formatDateTime(review.confirmedAt)}</time>,
                    date: <span className="font-mono">{review.arrivalBatchDate}</span>,
                  })}
                </p>
              )}

              <Duplicates items={review.items.filter((i) => i.kind === 'db_duplicate')} />
              {review.parcels.length > 0 && <ParcelTable parcels={review.parcels} />}

              <p className="mt-6 text-xs text-muted-foreground">{t('flow.rules', { rules: review.rules.join(', ') })}</p>
            </>
          )}
        </div>

        <footer className="border-t px-6 py-4">
          {live && notYet.length > 0 && (
            <ul aria-label={t('flow.before')} className="mb-3 space-y-1 text-sm text-warning">
              {notYet.map((n) => (
                <li key={n} className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {n}
                </li>
              ))}
            </ul>
          )}
          {actionError && (
            <p role="alert" className="mb-3 flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {actionError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {live && review && (
              <>
                <Button
                  disabled={!!busy || notYet.length > 0 || ready === 0 || !choice}
                  onClick={() =>
                    act(
                      'confirm',
                      () => confirmImport(review.id, { arrivalBatchDate, dateChoice: choice!, batchDateChosen: batchPick !== null }),
                      async (r) => {
                        onChanged();
                        const done = await getReview(r.id, null);
                        setStep({ s: 'review', review: done, added: done.counts.ready });
                      },
                    )
                  }
                >
                  {busy === 'confirm' && <Loader className="animate-spin motion-reduce:animate-none" aria-hidden />}
                  {busy === 'confirm' ? t('flow.importing') : ready === 0 ? t('flow.nothingNew') : t('flow.import', { count: ready })}
                </Button>
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() =>
                    act('cancel', () => cancelImport(review.id), () => {
                      onChanged();
                      onClose();
                    })
                  }
                >
                  {t('flow.discard')}
                </Button>
              </>
            )}
            {step?.s === 'error' && request && request.kind !== 'open' && (
              <Button variant="outline" onClick={() => start(request)}>
                {t('common.tryAgain')}
              </Button>
            )}
            <Button variant="ghost" className="ml-auto" disabled={!!busy} onClick={onClose}>
              {live ? t('flow.closeLater') : t('common.close')}
            </Button>
          </div>
        </footer>
      </SheetContent>
    </Sheet>
  );
}

function Problem({ heading, message }: { heading: React.ReactNode; message: string }) {
  return (
    <div role="alert" className="rounded-md bg-destructive-tint p-4 text-destructive">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {heading}
      </div>
      <p className="mt-1 pl-6">{message}</p>
    </div>
  );
}

function FileFacts({ review: r }: { review: Review }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 rounded-md border px-4 py-3">
      <FileSpreadsheet className="size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm" title={r.fileName}>
          {r.fileName}
        </p>
        <p className="text-xs text-muted-foreground">
          {r.format && `${r.format.toUpperCase()} · `}
          {t.rich('flow.facts', {
            size: formatBytes(r.sizeBytes),
            time: <time dateTime={r.checkedAt}>{formatDateTime(r.checkedAt)}</time>,
            source: r.source === 'folder' ? t('import.source.folder') : t('import.source.manual'),
          })}
        </p>
      </div>
      <StatusBadge status={r.status as ImportListItem['status']} />
    </div>
  );
}

function Counts({ review: r }: { review: Review }) {
  const t = useT();
  const rows: [MessageKey, number][] = [
    ['flow.rows.total', r.rows.total],
    ['flow.rows.shopee', r.rows.shopee],
    ['flow.rows.excluded', r.rows.excluded],
    ['flow.rows.collapsed', r.rows.collapsed],
  ];
  const parcels: [MessageKey, number, string?][] = [
    [r.status === 'imported' ? 'flow.closed.imported' : 'flow.count.ready', r.counts.ready, 'text-success'],
    ['flow.state.duplicate', r.counts.db_duplicate],
    ['flow.state.blocked', r.counts.blocked, 'text-warning'],
    ['flow.state.leftOut', r.counts.left_out],
  ];
  return (
    <>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {rows.map(([label, n]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{t(label)}</dt>
            <dd className="font-mono">{n}</dd>
          </div>
        ))}
      </dl>
      <h4 className="mt-5 text-sm font-semibold">
        {t('flow.parcels', { count: r.counts.unique })} <span className="font-normal text-muted-foreground">{t('flow.countedOnce')}</span>
      </h4>
      <dl className="mt-2 grid grid-cols-2 overflow-hidden rounded-md border sm:grid-cols-4 [&>div]:border-b sm:[&>div]:border-b-0 [&>div:not(:last-child)]:sm:border-r">
        {parcels.map(([label, n, tone]) => (
          <div key={label} className="px-4 py-3">
            <dt className="text-xs text-muted-foreground">{t(label)}</dt>
            <dd className={cn('mt-0.5 font-mono text-xl font-medium', n > 0 && tone)}>{n}</dd>
          </div>
        ))}
      </dl>
      {r.counts.db_duplicate > 0 && (
        <p className="mt-2 text-sm text-muted-foreground">{t('flow.keptAsIs')}</p>
      )}
      <FileCarriers review={r} />
    </>
  );
}

/**
 * The customers this file brings, by carrier, and how each will be told with the gateway phone's SIMs now (Phase 12).
 * One customer per phone number; before Confirm, only the parcels it would add.
 */
function FileCarriers({ review: r }: { review: Review }) {
  const t = useT();
  const sims = useParcelData()?.gateway.sims ?? [];
  const counted = r.parcels.filter((p) => (r.status === 'imported' ? p.state !== 'left_out' : p.state === 'ready' || p.state === 'blocked'));
  const phones = [...new Set(counted.map((p) => phoneKey(p.phone)).filter((k): k is string => k !== null))];
  const noPhone = counted.filter((p) => phoneKey(p.phone) === null).length;
  if (!phones.length) return null;
  return (
    <div className="mt-5">
      <h4 className="text-sm font-semibold">
        {t('flow.byCarrier', { count: phones.length })}{' '}
        <span className="font-normal text-muted-foreground">{noPhone ? t('flow.perPhoneNoNumber', { count: noPhone }) : t('flow.perPhone')}</span>
      </h4>
      <CarrierChips items={phones.map((phone) => ({ phone }))} sims={sims} className="mt-2" />
    </div>
  );
}

function EarlierImports({ review: r }: { review: Review }) {
  const t = useT();
  const partly = r.rerunOf !== null;
  return (
    <div role="alert" className="mt-4 rounded-md bg-warning-tint p-4 text-warning">
      <p className="flex items-start gap-2 font-medium">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {partly ? t('flow.partly') : t('flow.already')}
      </p>
      <ul className="mt-1 pl-6 text-foreground">
        {r.earlier.map((e) => (
          <li key={e.id}>
            {e.scanDate
              ? t('flow.earlierScan', { time: formatDateTime(e.confirmedAt), count: e.parcels, date: e.scanDate })
              : t('flow.earlier', { time: formatDateTime(e.confirmedAt), count: e.parcels })}
          </li>
        ))}
      </ul>
      <p className="mt-1 pl-6 text-foreground">
        {partly ? t('flow.partlyLead') : t('flow.alreadyLead')}
      </p>
    </div>
  );
}

type Decision = { resolution: 'left_out' } | { resolution: 'chosen'; chosen: Record<string, string> };

function Decisions({
  items,
  parcels,
  disabled,
  onDecide,
}: {
  items: ReviewItem[];
  parcels: Review['parcels'];
  disabled: boolean;
  onDecide: (item: ReviewItem, decision: Decision) => void;
}) {
  const t = useT();
  if (!items.length) return null;
  const codeOf = (key: string) => parcels.find((p) => p.key === key)?.code ?? key;
  return (
    <section aria-labelledby="decisions-heading" className="mt-6">
      <h4 id="decisions-heading" className="text-sm font-semibold">
        {t('flow.decisions')} <span className="font-normal text-muted-foreground">{t('flow.open', { count: items.filter((i) => !i.resolution).length })}</span>
      </h4>
      <ul className="mt-2 space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <DecisionCard item={item} code={codeOf(item.key)} disabled={disabled} onDecide={(d) => onDecide(item, d)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DecisionCard({ item, code, disabled, onDecide }: { item: ReviewItem; code: string; disabled: boolean; onDecide: (d: Decision) => void }) {
  const t = useT();
  const conflict = item.kind === 'recipient_conflict';
  const d = item.detail as { names?: string[]; phones?: string[]; spellings?: string[] };
  const groups: [field: string, label: MessageKey, values: string[]][] = conflict
    ? [
        ['name', 'flow.field.name', d.names ?? []],
        ['phone', 'flow.field.phone', d.phones ?? []],
      ]
    : [['code', 'flow.field.code', d.spellings ?? []]];
  const initial = Object.fromEntries(groups.map(([f, , values]) => [f, item.chosen?.[f] ?? (values.length === 1 ? values[0] : '')]));
  const [picked, setPicked] = useState<Record<string, string>>(initial);
  const complete = groups.every(([f]) => picked[f]);

  return (
    <fieldset className={cn('rounded-md border p-4', !item.resolution && 'border-warning')}>
      <legend className="px-1 text-sm">
        {t.rich(conflict ? 'flow.conflict' : 'flow.spelling', { code: <span className="font-mono">{code}</span> })}
      </legend>
      <p className="text-sm text-muted-foreground">
        {item.resolution === 'left_out'
          ? t('flow.decidedOut')
          : item.resolution === 'chosen'
            ? t('flow.decided', { values: Object.values(item.chosen ?? {}).join(', ') })
            : t('flow.chooseRight')}
      </p>
      {groups.map(([field, label, values]) => (
        <div key={field} role="radiogroup" aria-label={t(label)} className="mt-3">
          <p className="text-xs text-muted-foreground">{t(label)}</p>
          {values.length === 1 ? (
            <p className={field === 'name' ? '' : 'font-mono'}>{values[0]}</p>
          ) : (
            values.map((v) => (
              <label key={v} className="mt-1 flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-8">
                <input
                  type="radio"
                  name={`${item.id}-${field}`}
                  className="size-4 accent-primary"
                  checked={picked[field] === v}
                  disabled={disabled}
                  onChange={() => setPicked({ ...picked, [field]: v })}
                />
                {field === 'phone' ? <PhoneText raw={v} /> : <span className={field === 'code' ? 'font-mono' : ''}>{v}</span>}
              </label>
            ))
          )}
        </div>
      ))}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled || !complete} onClick={() => onDecide({ resolution: 'chosen', chosen: picked })}>
          {conflict ? t('flow.useNamePhone') : t('flow.useSpelling')}
        </Button>
        <Button size="sm" variant="outline" disabled={disabled || item.resolution === 'left_out'} onClick={() => onDecide({ resolution: 'left_out' })}>
          {t('flow.leaveOut')}
        </Button>
      </div>
    </fieldset>
  );
}

function ScanDates({
  review: r,
  choice,
  disabled,
  onChoose,
}: {
  review: Review;
  choice: DateChoice | null;
  disabled: boolean;
  onChoose: (c: DateChoice) => void;
}) {
  const t = useT();
  const unreadable = r.items.filter((i) => i.kind === 'unparseable_scan_time');
  const ask = r.dateChoiceNeeded || r.rerunOf !== null;
  const options: { value: DateChoice; label: string; off?: boolean }[] = [
    ...(r.rerunOf === null ? [{ value: { kind: 'all_on_batch_date' } as DateChoice, label: t('flow.allOnBatch') }] : []),
    ...r.scanDates
      .filter((d) => d.date !== null)
      .map((d) => ({
        value: { kind: 'only_scan_date', date: d.date! } as DateChoice,
        label: t(d.importedBefore ? 'flow.onlyScanDone' : 'flow.onlyScan', { date: d.date!, count: d.parcels }),
        off: d.importedBefore,
      })),
  ];
  const same = (a: DateChoice | null, b: DateChoice) => a?.kind === b.kind && (a.kind !== 'only_scan_date' || a.date === (b as { date: string }).date);

  return (
    <section aria-labelledby="scan-dates-heading" className="mt-6">
      <h4 id="scan-dates-heading" className="text-sm font-semibold">
        {t('flow.scanDates')}
      </h4>
      <ul className="mt-1 text-sm">
        {r.scanDates.map((d) => (
          <li key={d.date ?? 'none'}>
            {t.rich('flow.scanLine', { date: <span className="font-mono">{d.date ?? t('flow.unreadableTime')}</span> }, { count: d.parcels })}
          </li>
        ))}
      </ul>
      {unreadable.length > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          {t('flow.unreadableRows', {
            rows: unreadable.flatMap((i) => (i.detail as { rows: { row: number; text: string | null }[] }).rows.map((x) => `${x.row} (“${x.text ?? ''}”)`)).join(', '),
          })}
        </p>
      )}
      {ask && (
        <fieldset className="mt-3 rounded-md border p-4">
          <legend className="px-1 text-sm font-medium">{t('flow.whichOnes')}</legend>
          {options.map((o) => (
            <label key={o.label} className={cn('flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-8', o.off && 'cursor-not-allowed opacity-60')}>
              <input
                type="radio"
                name="date-choice"
                className="size-4 accent-primary"
                checked={same(choice, o.value)}
                disabled={disabled || o.off}
                onChange={() => onChoose(o.value)}
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      )}
    </section>
  );
}

function BatchDate({
  review: r,
  pick,
  otherDate,
  disabled,
  onPick,
  onOtherDate,
}: {
  review: Review;
  pick: string | null;
  otherDate: string;
  disabled: boolean;
  onPick: (p: string) => void;
  onOtherDate: (d: string) => void;
}) {
  const t = useT();
  const scanned = r.scanDates.flatMap((d) => (d.date && d.date !== r.today ? [d.date] : []));
  const options: [value: string, label: string][] = [
    ['today', t('flow.today', { date: r.today })],
    ...scanned.map((d): [string, string] => [d, t('flow.theScanDate', { date: d })]),
  ];

  return (
    <section aria-labelledby="batch-heading" className="mt-6">
      <h4 id="batch-heading" className="text-sm font-semibold">
        {t('flow.batch')}
      </h4>
      <p className="text-sm text-muted-foreground">{t('flow.batchLead')}</p>
      {r.scanDateDiffers && (
        <p className="mt-2 flex items-start gap-2 rounded-md bg-warning-tint p-3 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t('flow.scannedOn', { dates: scanned.join(', '), today: r.today })}
          </span>
        </p>
      )}
      <fieldset className="mt-2">
        <legend className="sr-only">{t('flow.batch')}</legend>
        {options.map(([value, label]) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-8">
            <input type="radio" name="batch-date" className="size-4 accent-primary" checked={pick === value} disabled={disabled} onChange={() => onPick(value)} />
            {label}
          </label>
        ))}
        <label className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 sm:min-h-8">
          <input type="radio" name="batch-date" className="size-4 accent-primary" checked={pick === 'other'} disabled={disabled} onChange={() => onPick('other')} />
          {t('flow.another')}
          <Input
            type="date"
            aria-label={t('flow.anotherLabel')}
            className="h-9 w-auto"
            max={r.today}
            value={otherDate}
            disabled={disabled}
            onChange={(e) => onOtherDate(e.target.value)}
          />
        </label>
      </fieldset>
    </section>
  );
}

function Duplicates({ items }: { items: ReviewItem[] }) {
  const t = useT();
  if (!items.length) return null;
  return (
    <details className="mt-6">
      <summary className="cursor-pointer text-sm font-semibold">{t('flow.inRecords', { count: items.length })}</summary>
      <p className="mt-1 text-sm text-muted-foreground">{t('flow.skipped')}</p>
      <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-2">
        {items.map((i) => {
          const d = i.detail as { storedCode: string; caseOnly: boolean };
          return (
            <li key={i.id}>
              {d.storedCode}
              {d.caseOnly && <span className="font-sans text-xs text-muted-foreground">{t('flow.caseOnly')}</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function ParcelTable({ parcels }: { parcels: Review['parcels'] }) {
  const t = useT();
  return (
    <details className="mt-6">
      <summary className="cursor-pointer text-sm font-semibold">{t('flow.inFile', { count: parcels.length })}</summary>
      <div className="mt-2 rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('parcels.col.code')}</TableHead>
              <TableHead>{t('parcels.col.recipient')}</TableHead>
              <TableHead>{t('parcels.col.phone')}</TableHead>
              <TableHead>{t('flow.col.scanned')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('flow.col.result')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parcels.map((p) => (
              <TableRow key={p.key} className={cn(p.state !== 'ready' && p.state !== 'blocked' && 'text-muted-foreground')}>
                <TableCell className="font-mono">{p.code}</TableCell>
                <TableCell>{p.name}</TableCell>
                <TableCell>
                  <PhoneText raw={p.phone} />
                </TableCell>
                <TableCell className="font-mono whitespace-nowrap">
                  {p.scanDate ?? '?'}
                  {p.scans > 1 && <span className="font-sans text-xs text-muted-foreground"> ×{p.scans}</span>}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant={PARCEL_STATE[p.state].variant}>{t(PARCEL_STATE[p.state].label)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </details>
  );
}
