'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  eligibleForMessage,
  formatPhone,
  inFilter,
  matchesSearch,
  phoneGroup,
  phoneKey,
  smsStatusOf,
  type Parcel,
  type ParcelFilter,
} from '@/lib/parcel-logic';
import { ANY_DATE, inDateRange, isAnyDate, rangePhrase, type DateRange } from '@/lib/date-range';
import { reloadParcels, useParcelData, useParcelError } from '@/lib/parcel-service';
import { DateFilter } from '@/components/shared/date-filter';
import { SampleDataNotice } from '@/components/shared/sample-data-notice';
import { cn, formatDateTime } from '@/lib/utils';
import { ParcelDetail } from './parcel-detail';
import { PhoneText, SmsBadge } from './parcel-status';
import { PhoneGroups } from './phone-groups';
import { GroupBadge, GroupList, toNotifyLine } from './phone-group';
import { useT, type MessageKey } from '@/lib/i18n-react';

// The counts double as the filters, so the summary and the filter can never disagree.
const FILTERS: { key: ParcelFilter; label: MessageKey; empty: MessageKey }[] = [
  { key: 'all', label: 'parcels.filter.all', empty: 'parcels.filter.allEmpty' },
  { key: 'sms-failed', label: 'parcels.filter.failed', empty: 'parcels.filter.failedEmpty' },
  { key: 'no-phone', label: 'parcels.filter.noPhone', empty: 'parcels.filter.noPhoneEmpty' },
];
// A customer group is one phone number in one arrival batch, the same unit a combined SMS covers.
const batchKey = (p: Parcel) => {
  const phone = phoneKey(p.phone);
  return phone && `${p.arrivalDate}|${phone}`;
};
const groupCount = (parcels: Parcel[]) => new Set(parcels.flatMap((p) => batchKey(p) ?? [])).size;
const TODAY: DateRange = { preset: 'today' };

export function ParcelBrowser({ initialQuery, initialFilter, previewError }: { initialQuery: string; initialFilter?: string; previewError?: boolean }) {
  const t = useT();
  const data = useParcelData();
  const loadError = useParcelError();
  const loadFailed = previewError || !!loadError;
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<ParcelFilter>(FILTERS.find((f) => f.key === initialFilter)?.key ?? 'all');
  // The day's arrival batch is the default. Arriving with a search or a filter link means looking something up: all dates.
  const [dates, setDates] = useState<DateRange>(initialQuery || initialFilter ? ANY_DATE : TODAY);
  const [open, setOpen] = useState<string | null>(null);
  /** A parcel code; its phone group is shown in the group panel. */
  const [groupOf, setGroupOf] = useState<string | null>(null);
  // Grouped by phone is the default: staff think in customers to tell, not in single parcels.
  const [view, setView] = useState<'grouped' | 'individual'>('grouped');

  const events = data?.events ?? [];
  // Group sizes always count every parcel on the line, whatever the filters hide.
  const onLine = new Map<string, number>();
  for (const p of data?.parcels ?? []) {
    const key = batchKey(p);
    if (key) onLine.set(key, (onLine.get(key) ?? 0) + 1);
  }
  const sizeOf = (p: Parcel) => onLine.get(batchKey(p) ?? '') ?? 1; // no valid phone: never grouped
  // Counts follow the date, so "SMS failed" reads as "failed among parcels that arrived then".
  const arrivedIn = (p: Parcel) => inDateRange(`${p.arrivalDate}T00:00:00`, dates); // local midnight of the arrival day
  const dated = data?.parcels.filter(arrivedIn) ?? [];
  const count = (f: ParcelFilter) => dated.filter((p) => inFilter(p, events, f)).length;

  const rows = data
    ? dated.filter((p) => inFilter(p, events, filter) && matchesSearch(p, query)).sort((a, b) => b.importedAt.localeCompare(a.importedAt))
    : null;
  const openParcel = data?.parcels.find((p) => p.code === open);
  const groupParcel = data?.parcels.find((p) => p.code === groupOf);
  const groupParcels = groupParcel && data ? phoneGroup(groupParcel, data.parcels).sort((a, b) => b.importedAt.localeCompare(a.importedAt)) : [];
  const anyDate = isAnyDate(dates);
  const narrowed = filter !== 'all' || query.trim() !== '' || dates.preset !== 'today';
  // Search stays within the chosen dates, but says when the same search finds parcels on other days.
  const elsewhere =
    data && query.trim() && !anyDate ? data.parcels.filter((p) => !arrivedIn(p) && inFilter(p, events, filter) && matchesSearch(p, query)).length : 0;
  const active = FILTERS.find((f) => f.key === filter)!;
  const reset = () => {
    setQuery('');
    setFilter('all');
    setDates(TODAY);
  };

  const row = (p: Parcel) => (
    <TableRow key={p.code} className="cursor-pointer" onClick={() => setOpen(p.code)}>
      <TableCell>
        {/* The row click is a shortcut; the code (and View details on wide screens) is the keyboard path. */}
        <button
          type="button"
          className="font-mono font-medium text-primary underline-offset-4 hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(p.code);
          }}
        >
          {p.code}
        </button>
        {/* Phones: the hidden columns, stacked under the code. */}
        <span className="block text-xs text-muted-foreground md:hidden">
          {p.recipient} · <PhoneText raw={p.phone} />
        </span>
        <GroupBadge size={sizeOf(p)} onClick={() => setGroupOf(p.code)} className="mt-1 xl:hidden" />
        <span className="mt-1.5 flex flex-wrap gap-1 md:hidden">
          <SmsBadge status={smsStatusOf(p.code, events)} />
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">{p.recipient}</TableCell>
      <TableCell className="hidden md:table-cell">
        <PhoneText raw={p.phone} />
        {!phoneKey(p.phone) && (
          <Button variant="link" size="sm" className="ml-1 h-auto px-1 sm:h-auto" onClick={(e) => {
              e.stopPropagation();
              setOpen(p.code);
            }}
          >
            {t('groups.addPhone')}
          </Button>
        )}
      </TableCell>
      <TableCell className="hidden font-mono 2xl:table-cell">{formatDateTime(p.importedAt)}</TableCell>
      <TableCell className="hidden xl:table-cell">
        {sizeOf(p) > 1 ? (
          <GroupBadge size={sizeOf(p)} onClick={() => setGroupOf(p.code)} />
        ) : (
          <span className="text-muted-foreground" aria-label={t('parcels.noOthers')}>
            –
          </span>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <SmsBadge status={smsStatusOf(p.code, events)} bare />
      </TableCell>
      <TableCell className="hidden text-right xl:table-cell">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(p.code);
          }}
          aria-label={t('parcels.viewFor', { code: p.code })}
        >
          {t('history.action.details')}
          <ChevronRight aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  );

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">{t('nav.parcels')}</h1>
          <p className="mt-1 text-muted-foreground">{t('parcels.lead')}</p>
        </div>
        <div className="relative w-full md:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor="parcel-filter" className="sr-only">
            {t('parcels.search')}
          </label>
          <Input
            id="parcel-filter"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('parcels.searchPlaceholder')}
            className="pl-9"
            autoComplete="off"
          />
        </div>
      </div>

      <SampleDataNotice>
        {t('parcels.sampleNotice')}
      </SampleDataNotice>

      {!loadFailed && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t('parcels.show')} className="flex flex-wrap gap-1.5">
            {/* "No phone number" appears only while there is something to fix, or when chosen. */}
            {FILTERS.filter((f) => f.key !== 'no-phone' || filter === 'no-phone' || count(f.key) > 0).map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'inline-flex h-11 items-center gap-2 rounded-md border px-3 text-sm sm:h-9',
                  filter === f.key ? 'border-primary bg-accent font-medium text-primary' : 'bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {t(f.label)}
                <span className={cn('font-mono font-semibold', filter !== f.key && 'text-foreground')}>{data ? count(f.key) : '–'}</span>
              </button>
            ))}
          </div>
          <DateFilter value={dates} onChange={setDates} label={t('parcels.dateLabel')} />
          {narrowed && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <X aria-hidden />
              {t('parcels.clear')}
            </Button>
          )}
        </div>
      )}

      <section aria-label={t('parcels.list')} className="mt-4 rounded-md border bg-card">
        {loadFailed ? (
          <div role="alert" className="px-5 py-10">
            <p className="font-medium">{t('parcels.loadFailed')}</p>
            <p className="mt-1 text-muted-foreground">{loadError ?? t('parcels.loadFailedLead')}</p>
            <Button variant="outline" className="mt-4" onClick={reloadParcels}>
              {t('common.tryAgain')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-3 pb-3">
              <p aria-live="polite" className="text-sm text-muted-foreground">
                {rows && (
                  <>
                    <span className="font-medium text-foreground">
                      {dates.preset === 'today'
                        ? t('parcels.countToday', { count: rows.length })
                        : anyDate
                          ? t('parcels.count', { count: rows.length })
                          : t('parcels.countRange', { count: rows.length, range: rangePhrase(dates, t) })}
                    </span>
                    {view === 'grouped' && t('parcels.groups', { count: groupCount(rows) })}
                    {filter !== 'all' && <> · {t(active.label)}</>}
                    {query.trim() && t('parcels.matching', { query: query.trim() })}
                    {elsewhere > 0 && (
                      <>
                        {' · '}
                        <button type="button" onClick={() => setDates(ANY_DATE)} className="font-medium text-primary underline-offset-4 hover:underline">
                          {t('parcels.elsewhere', { count: elsewhere })}
                        </button>
                      </>
                    )}
                  </>
                )}
              </p>
              <div role="group" aria-label={t('parcels.view')} className="inline-flex rounded-md bg-secondary p-0.5 text-sm">
                {(
                  [
                    ['grouped', 'parcels.grouped'],
                    ['individual', 'parcels.individual'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={view === key}
                    onClick={() => setView(key)}
                    className={cn(
                      'h-10 rounded-sm px-3 sm:h-7',
                      view === key ? 'bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--color-border)]' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            </div>
            {rows && rows.length === 0 ? (
              <div className="border-t px-5 py-10">
                {query.trim() ? (
                  <>
                    <p className="font-medium">
                      {t('parcels.noMatch', { query: query.trim() })}
                      {filter !== 'all' && t('parcels.noMatchIn', { filter: t(active.label) })}
                      {!anyDate && t('parcels.noMatchArrived', { range: rangePhrase(dates, t) })}
                    </p>
                    <p className="mt-1 text-muted-foreground">{t('parcels.noMatchLead')}</p>
                  </>
                ) : data!.parcels.length === 0 ? (
                  <>
                    <p className="font-medium">{t('parcels.filter.allEmpty')}</p>
                    <p className="mt-1 text-muted-foreground">{t('parcels.emptyLead')}</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">
                      {t(filter !== 'all' ? active.empty : dates.preset === 'today' ? 'parcels.noneToday' : 'parcels.nonePeriod')}
                    </p>
                    {!anyDate && (
                      <p className="mt-1 text-muted-foreground">
                        {dates.preset === 'today' ? t('parcels.noneTodayLead') : t('parcels.nonePeriodLead', { range: rangePhrase(dates, t) })}
                      </p>
                    )}
                  </>
                )}
                {elsewhere > 0 ? (
                  <Button variant="outline" className="mt-4" onClick={() => setDates(ANY_DATE)}>
                    {t('parcels.showElsewhere', { count: elsewhere })}
                  </Button>
                ) : narrowed ? (
                  <Button variant="outline" className="mt-4" onClick={reset}>
                    {t('parcels.clear')}
                  </Button>
                ) : (
                  <Button asChild variant="outline" className="mt-4">
                    <Link href="/import-arrivals">{t('parcels.importLink')}</Link>
                  </Button>
                )}
              </div>
            ) : rows && view === 'grouped' ? (
              <PhoneGroups rows={rows} batch={dated} events={events} expandAll={query.trim() !== ''} onOpen={setOpen} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t('parcels.col.code')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('parcels.col.recipient')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('parcels.col.phone')}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t('parcels.col.imported')}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t('parcels.col.same')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('parcels.col.sms')}</TableHead>
                    <TableHead className="hidden xl:table-cell">
                      <span className="sr-only">{t('common.actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!rows
                    ? Array.from({ length: 6 }, (_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={7}>
                            <Skeleton className="h-5 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    : rows.map(row)}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </section>

      <Sheet open={!!groupParcel} onOpenChange={(o) => !o && setGroupOf(null)}>
        <SheetContent className="max-w-xl bg-background" aria-describedby={undefined}>
          {groupParcel && (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-14 pb-6 sm:px-6">
              <p className="text-xs text-muted-foreground">{t('parcels.groupTitle')}</p>
              <SheetTitle className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-semibold">
                <span className="font-mono">{formatPhone(groupParcel.phone)}</span>
                <GroupBadge size={groupParcels.length} />
              </SheetTitle>
              <p className="mt-2 text-sm">
                {t('parcels.groupLead', { line: toNotifyLine(eligibleForMessage(groupParcels, events).length, groupParcels.length, t) })}
              </p>
              <GroupList
                parcels={groupParcels}
                events={events}
                onSelect={(code) => {
                  setGroupOf(null);
                  setOpen(code);
                }}
                className="mt-4"
              />
              <Button
                className="mt-4"
                onClick={() => {
                  setGroupOf(null);
                  setOpen(groupParcels[0].code);
                }}
              >
                {t('parcels.contactCustomer')}
              </Button>
              <p className="mt-2 text-sm text-muted-foreground">{t('parcels.contactLead')}</p>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!openParcel} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="max-w-2xl bg-background" aria-describedby={undefined}>
          {openParcel && data && (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-14 pb-6 sm:px-6">
              <ParcelDetail parcel={openParcel} data={data} Title={SheetTitle} onSelect={setOpen} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
