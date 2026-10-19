'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, MessageSquare, Phone, ScanBarcode, Search, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  contactStatusOf,
  eligibleForMessage,
  formatPhone,
  inFilter,
  normalizePhone,
  phoneGroup,
  phoneKey,
  smsStatusOf,
  telegramLink,
  type Parcel,
  type ParcelFilter,
} from '@/lib/parcel-logic';
import { ANY_DATE, inDateRange, isAnyDate, rangePhrase, type DateRange } from '@/lib/date-range';
import { reloadParcels, useParcelData, useParcelError } from '@/lib/mock/parcel-service';
import { DateFilter } from '@/components/shared/date-filter';
import { SampleDataNotice } from '@/components/shared/sample-data-notice';
import { cn, formatDateTime } from '@/lib/utils';
import { ParcelDetail } from './parcel-detail';
import { ContactBadge, PhoneText, SmsBadge } from './parcel-status';
import { PhoneGroups } from './phone-groups';
import { GroupBadge, GroupList, toNotifyLine } from './phone-group';

// The counts double as the filters, so the summary and the filter can never disagree.
const FILTERS: { key: ParcelFilter; label: string; empty: string }[] = [
  { key: 'all', label: 'All parcels', empty: 'No parcels yet' },
  { key: 'needs-contact', label: 'Needs contact', empty: 'Nobody is waiting for a first contact' },
  { key: 'sms-failed', label: 'SMS failed', empty: 'No failed SMS' },
  { key: 'follow-up', label: 'Follow-up needed', empty: 'No follow-ups needed' },
  { key: 'contacted', label: 'Contacted', empty: 'No parcels marked contacted yet' },
  { key: 'no-phone', label: 'No phone number', empty: 'Every parcel has a phone number' },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
// A customer group is one phone number in one arrival batch, the same unit a combined SMS covers.
const batchKey = (p: Parcel) => {
  const phone = phoneKey(p.phone);
  return phone && `${p.arrivalDate}|${phone}`;
};
const groupCount = (parcels: Parcel[]) => new Set(parcels.flatMap((p) => batchKey(p) ?? [])).size;
const TODAY: DateRange = { preset: 'today' };

function matches(p: Parcel, q: string) {
  const text = q.trim().toLowerCase();
  if (!text) return true;
  const digits = normalizePhone(text);
  return (
    p.code.toLowerCase().includes(text.replace(/\s+/g, '')) ||
    p.recipient.toLowerCase().includes(text) ||
    (digits.length >= 4 && normalizePhone(p.phone).includes(digits.replace(/^0/, '')))
  );
}

export function ParcelBrowser({ initialQuery, initialFilter, previewError }: { initialQuery: string; initialFilter?: string; previewError?: boolean }) {
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
  // Counts follow the date, so "Needs contact" reads as "needs contact among parcels that arrived then".
  const arrivedIn = (p: Parcel) => inDateRange(`${p.arrivalDate}T00:00:00`, dates); // local midnight of the arrival day
  const dated = data?.parcels.filter(arrivedIn) ?? [];
  const count = (f: ParcelFilter) => dated.filter((p) => inFilter(p, events, f)).length;

  const rows = data
    ? dated.filter((p) => inFilter(p, events, filter) && matches(p, query)).sort((a, b) => b.importedAt.localeCompare(a.importedAt))
    : null;
  const openParcel = data?.parcels.find((p) => p.code === open);
  const groupParcel = data?.parcels.find((p) => p.code === groupOf);
  const groupParcels = groupParcel && data ? phoneGroup(groupParcel, data.parcels).sort((a, b) => b.importedAt.localeCompare(a.importedAt)) : [];
  const anyDate = isAnyDate(dates);
  const narrowed = filter !== 'all' || query.trim() !== '' || dates.preset !== 'today';
  // Search stays within the chosen dates, but says when the same search finds parcels on other days.
  const elsewhere =
    data && query.trim() && !anyDate ? data.parcels.filter((p) => !arrivedIn(p) && inFilter(p, events, filter) && matches(p, query)).length : 0;
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
        {/* Phones: one stacked cell, so each badge names its own system. */}
        <span className="mt-1.5 flex flex-wrap gap-1 md:hidden">
          <SmsBadge status={smsStatusOf(p.code, events)} />
          <ContactBadge status={contactStatusOf(p.code, events)} />
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
            Add phone
          </Button>
        )}
      </TableCell>
      <TableCell className="hidden font-mono 2xl:table-cell">{formatDateTime(p.importedAt)}</TableCell>
      <TableCell className="hidden xl:table-cell">
        {sizeOf(p) > 1 ? (
          <GroupBadge size={sizeOf(p)} onClick={() => setGroupOf(p.code)} />
        ) : (
          <span className="text-muted-foreground" aria-label="No other parcels">
            –
          </span>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <SmsBadge status={smsStatusOf(p.code, events)} bare />
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <ContactBadge status={contactStatusOf(p.code, events)} bare />
      </TableCell>
      <TableCell className="hidden text-right xl:table-cell">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(p.code);
          }}
          aria-label={`View details for ${p.code}`}
        >
          View details
          <ChevronRight aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  );

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">Parcels</h1>
          <p className="mt-1 text-muted-foreground">Every parcel in the branch records. Find one, check who still needs contacting, or fix a phone number.</p>
        </div>
        <div className="relative w-full md:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor="parcel-filter" className="sr-only">
            Search by tracking code, name or phone
          </label>
          <Input
            id="parcel-filter"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tracking code, name or phone"
            className="pl-9"
            autoComplete="off"
          />
        </div>
      </div>

      <SampleDataNotice>
        Parcels and phone numbers are saved. Messages, calls and follow-up notes are not saved yet: they reset when the page reloads, and no SMS leaves this device.
      </SampleDataNotice>

      {!loadFailed && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Show parcels" className="flex flex-wrap gap-1.5">
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
                {f.label}
                <span className={cn('font-mono font-semibold', filter !== f.key && 'text-foreground')}>{data ? count(f.key) : '–'}</span>
              </button>
            ))}
          </div>
          <DateFilter value={dates} onChange={setDates} label="Imported date" />
          {narrowed && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <X aria-hidden />
              Clear filters
            </Button>
          )}
        </div>
      )}

      <section aria-label="Parcel list" className="mt-4 rounded-md border bg-card">
        {loadFailed ? (
          <div role="alert" className="px-5 py-10">
            <p className="font-medium">The parcel list could not be loaded</p>
            <p className="mt-1 text-muted-foreground">{loadError ?? 'Nothing was changed. Check that the office computer is on, then try again.'}</p>
            <Button variant="outline" className="mt-4" onClick={reloadParcels}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-3 pb-3">
              <p aria-live="polite" className="text-sm text-muted-foreground">
                {rows && (
                  <>
                    <span className="font-medium text-foreground">
                      {plural(rows.length, 'parcel')}
                      {dates.preset === 'today' ? ' arriving today' : anyDate ? '' : ` arrived ${rangePhrase(dates)}`}
                    </span>
                    {view === 'grouped' && <> · {plural(groupCount(rows), 'customer group')}</>}
                    {filter !== 'all' && <> · {active.label}</>}
                    {query.trim() && <> · matching &ldquo;{query.trim()}&rdquo;</>}
                    {elsewhere > 0 && (
                      <>
                        {' · '}
                        <button type="button" onClick={() => setDates(ANY_DATE)} className="font-medium text-primary underline-offset-4 hover:underline">
                          {elsewhere} more on other days
                        </button>
                      </>
                    )}
                  </>
                )}
              </p>
              <div role="group" aria-label="View" className="inline-flex rounded-md bg-secondary p-0.5 text-sm">
                {(
                  [
                    ['grouped', 'Grouped by phone'],
                    ['individual', 'Individual parcels'],
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
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {rows && rows.length === 0 ? (
              <div className="border-t px-5 py-10">
                {query.trim() ? (
                  <>
                    <p className="font-medium">
                      No parcel matches &ldquo;{query.trim()}&rdquo;{filter !== 'all' && ` in ${active.label}`}
                      {!anyDate && `, arrived ${rangePhrase(dates)}`}
                    </p>
                    <p className="mt-1 text-muted-foreground">Check the tracking code, or search by the recipient&apos;s phone number instead.</p>
                  </>
                ) : data!.parcels.length === 0 ? (
                  <>
                    <p className="font-medium">No parcels yet</p>
                    <p className="mt-1 text-muted-foreground">Parcels appear here once an arrivals file is imported.</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">
                      {filter !== 'all' ? active.empty : dates.preset === 'today' ? 'No arrivals imported today yet' : 'No parcels arrived in this period'}
                    </p>
                    {!anyDate && (
                      <p className="mt-1 text-muted-foreground">
                        {dates.preset === 'today'
                          ? "Import today's arrival export to start notifying customers. Earlier days are under the date filter."
                          : `Showing parcels that arrived ${rangePhrase(dates)}. Try a wider date range.`}
                      </p>
                    )}
                  </>
                )}
                {elsewhere > 0 ? (
                  <Button variant="outline" className="mt-4" onClick={() => setDates(ANY_DATE)}>
                    Show {elsewhere} on other days
                  </Button>
                ) : narrowed ? (
                  <Button variant="outline" className="mt-4" onClick={reset}>
                    Clear filters
                  </Button>
                ) : (
                  <Button asChild variant="outline" className="mt-4">
                    <Link href="/import-arrivals">Import arrivals</Link>
                  </Button>
                )}
              </div>
            ) : rows && view === 'grouped' ? (
              <PhoneGroups rows={rows} batch={dated} events={events} expandAll={query.trim() !== ''} onOpen={setOpen} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Tracking code</TableHead>
                    <TableHead className="hidden md:table-cell">Recipient</TableHead>
                    <TableHead className="hidden md:table-cell">Phone</TableHead>
                    <TableHead className="hidden 2xl:table-cell">Imported</TableHead>
                    <TableHead className="hidden xl:table-cell">Same phone</TableHead>
                    <TableHead className="hidden md:table-cell">SMS</TableHead>
                    <TableHead className="hidden md:table-cell">Contact</TableHead>
                    <TableHead className="hidden xl:table-cell">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!rows
                    ? Array.from({ length: 6 }, (_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={8}>
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
              <p className="text-xs text-muted-foreground">Phone number group</p>
              <SheetTitle className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-semibold">
                <span className="font-mono">{formatPhone(groupParcel.phone)}</span>
                <GroupBadge size={groupParcels.length} />
              </SheetTitle>
              <p className="mt-2 text-sm">
                {toNotifyLine(eligibleForMessage(groupParcels, events).length, groupParcels.length)}. Matched by phone number, not name. Each parcel keeps
                its own record and statuses.
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
                Contact this customer
              </Button>
              <p className="mt-2 text-sm text-muted-foreground">Opens the newest parcel. Its message covers only the parcels not notified yet.</p>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!openParcel} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="max-w-2xl bg-background" aria-describedby={undefined}>
          {openParcel && data && (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-14 pb-6 sm:px-6">
              <ParcelDetail parcel={openParcel} data={data} Title={SheetTitle} onSelect={setOpen} actions={<QuickActions parcel={openParcel} />} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Shortcuts only: sending, recording and history live in the contact panel below. */
function QuickActions({ parcel }: { parcel: Parcel }) {
  const scan = (
    <Button asChild variant="outline" size="sm">
      <Link href="/scan">
        <ScanBarcode aria-hidden />
        Scan Parcel
      </Link>
    </Button>
  );
  if (!phoneKey(parcel.phone)) return <div className="flex flex-wrap gap-2">{scan}</div>; // nothing to call or message yet
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm">
        <a href={`tel:${normalizePhone(parcel.phone)}`}>
          <Phone aria-hidden />
          Call
        </a>
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const box = document.getElementById('contact-heading');
          box?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          (document.getElementById('sms-preview') ?? box)?.focus({ preventScroll: true });
        }}
      >
        <Send aria-hidden />
        SMS
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={telegramLink(parcel.phone)} target="_blank" rel="noreferrer">
          <MessageSquare aria-hidden />
          Telegram
        </a>
      </Button>
      {scan}
    </div>
  );
}
