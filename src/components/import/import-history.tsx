'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DateFilter } from '@/components/shared/date-filter';
import { ANY_DATE, inDateRange, isAnyDate, rangePhrase, type DateRange } from '@/lib/date-range';
import type { ImportListItem } from '@/lib/import-api';
import { cn, formatDateTime } from '@/lib/utils';
import { StatusBadge } from './status-badge';
import { useT, type MessageKey } from '@/lib/i18n-react';

type Item = ImportListItem;
type SortKey = 'fileName' | 'source' | 'at' | 'added' | 'duplicates' | 'status';

const COLUMNS: { key: SortKey; label: MessageKey; numeric?: boolean }[] = [
  { key: 'fileName', label: 'history.col.file' },
  { key: 'source', label: 'history.col.source' },
  { key: 'at', label: 'history.col.when' },
  { key: 'added', label: 'history.col.added', numeric: true },
  { key: 'duplicates', label: 'history.col.skipped', numeric: true },
  { key: 'status', label: 'history.col.status' },
];

const STATUS_ORDER: Record<Item['status'], number> = { checked: 0, failed: 1, no_eligible_rows: 2, cancelled: 3, imported: 4 };

type Filter = 'all' | 'checked' | 'failed';
const FILTERS: { key: Filter; label: MessageKey }[] = [
  { key: 'all', label: 'history.filter.all' },
  { key: 'checked', label: 'history.filter.waiting' },
  { key: 'failed', label: 'history.filter.failed' },
];

export const importAction = (status: Item['status']): MessageKey =>
  status === 'checked' ? 'history.action.continue' : status === 'failed' ? 'history.action.why' : 'history.action.details';
/** When it was imported, or when it was checked if it never was. */
export const importTime = (r: Item) => r.confirmedAt ?? r.checkedAt;

const NOT_IMPORTED: Record<Exclude<Item['status'], 'imported'>, MessageKey> = {
  checked: 'history.notImported.checked',
  failed: 'history.notImported.failed',
  no_eligible_rows: 'history.notImported.noShopee',
  cancelled: 'history.notImported.cancelled',
};

const sortValue = (r: Item, key: SortKey): string | number => {
  switch (key) {
    case 'at':
      return importTime(r);
    case 'status':
      return STATUS_ORDER[r.status];
    default:
      return r[key];
  }
};

export function ImportHistory({
  records,
  error,
  onRetry,
  onView,
}: {
  records: Item[] | null;
  error: string | null;
  onRetry: () => void;
  onView: (record: Item) => void;
}) {
  const t = useT();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'at', dir: -1 });
  const [filter, setFilter] = useState<Filter>('all');
  const [dates, setDates] = useState<DateRange>(ANY_DATE);
  const anyDate = isAnyDate(dates);

  const dated = useMemo(() => records?.filter((r) => inDateRange(importTime(r), dates)) ?? [], [records, dates]);
  const count = (f: Filter) => dated.filter((r) => f === 'all' || r.status === f).length;

  const sorted = useMemo(() => {
    if (!records) return null;
    return dated.filter((r) => filter === 'all' || r.status === filter).sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [records, dated, sort, filter]);
  const showAll = () => {
    setFilter('all');
    setDates(ANY_DATE);
  };

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'at' ? -1 : 1 }));

  return (
    <section aria-labelledby="history-heading" className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
        <h2 id="history-heading" className="text-base font-semibold">
          {t('history.title')}
        </h2>
        {records && records.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <DateFilter value={dates} onChange={setDates} label={t('history.dateLabel')} compact />
            <div role="group" aria-label={t('history.show')} className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'inline-flex h-11 items-center gap-1.5 rounded-sm border px-3 text-sm sm:h-8',
                    filter === f.key ? 'border-primary bg-accent font-medium text-primary' : 'bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(f.label)}
                  <span className="font-mono text-xs">{count(f.key)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error ? (
        <div role="alert" className="border-t px-5 py-8">
          <p className="font-medium text-destructive">{t('history.loadFailed')}</p>
          <p className="mt-1 text-muted-foreground">{t('history.notAffected', { error })}</p>
          <Button variant="outline" className="mt-4" onClick={onRetry}>
            {t('common.tryAgain')}
          </Button>
        </div>
      ) : sorted && sorted.length === 0 && records!.length > 0 ? (
        <div className="border-t px-5 py-10">
          <p className="font-medium">
            {anyDate
              ? t(filter === 'failed' ? 'history.noneFailed' : 'history.noneWaiting')
              : t(filter === 'failed' ? 'history.noneInRange.failed' : filter === 'checked' ? 'history.noneInRange.waiting' : 'history.noneInRange.all', {
                  range: rangePhrase(dates, t),
                })}
          </p>
          <p className="mt-1 text-muted-foreground">
            <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={showAll}>
              {t('history.showAll')}
            </button>
          </p>
        </div>
      ) : sorted && sorted.length === 0 ? (
        <div className="border-t px-5 py-10">
          <p className="font-medium">{t('history.empty')}</p>
          <p className="mt-1 text-muted-foreground">
            {t('history.emptyLead')}
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((c) => {
                const active = sort.key === c.key;
                const Icon = !active ? ChevronsUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
                return (
                  <TableHead
                    key={c.key}
                    aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                    className={c.numeric ? 'text-right' : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      className="-mx-1 inline-flex h-11 items-center sm:h-8 gap-1 rounded-sm px-1 hover:text-foreground"
                    >
                      {t(c.label)}
                      <Icon className="size-3.5" aria-hidden />
                    </button>
                  </TableHead>
                );
              })}
              <TableHead>
                <span className="sr-only">{t('common.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!sorted
              ? Array.from({ length: 4 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={COLUMNS.length + 1}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : sorted.map((r) => (
                  <TableRow
                    key={r.id}
                    className={cn(
                      r.status === 'failed' && 'bg-destructive-wash hover:bg-destructive-tint/60',
                    )}
                  >
                    <TableCell className="max-w-64 truncate font-mono" title={r.fileName}>
                      {r.fileName}
                    </TableCell>
                    <TableCell>{r.source === 'manual' ? t('import.source.manual') : t('import.source.folder')}</TableCell>
                    <TableCell className="font-mono">{formatDateTime(importTime(r))}</TableCell>
                    {r.status !== 'imported' ? (
                      // Nothing was imported, so counts would only look like an empty file.
                      <TableCell colSpan={2} className="text-right text-muted-foreground">
                        {t(NOT_IMPORTED[r.status])}
                      </TableCell>
                    ) : (
                      <>
                        <TableCell className="text-right font-mono">{r.added}</TableCell>
                        <TableCell className="text-right font-mono">{r.duplicates}</TableCell>
                      </>
                    )}
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="link" size="sm" onClick={() => onView(r)} aria-label={t('import.latest.actionFor', { action: t(importAction(r.status)), file: r.fileName })}>
                        {t(importAction(r.status))}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
