'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DateFilter } from '@/components/shared/date-filter';
import { ANY_DATE, inDateRange, isAnyDate, rangePhrase, type DateRange } from '@/lib/date-range';
import type { ImportRecord } from '@/lib/import-logic';
import { cn, formatDateTime } from '@/lib/utils';
import { StatusBadge } from './status-badge';

type SortKey = 'fileName' | 'source' | 'importedAt' | 'newRecords' | 'duplicates' | 'status';

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'fileName', label: 'File' },
  { key: 'source', label: 'Source' },
  { key: 'importedAt', label: 'Imported' },
  { key: 'newRecords', label: 'Records added', numeric: true },
  { key: 'duplicates', label: 'Duplicates skipped', numeric: true },
  { key: 'status', label: 'Status' },
];

const STATUS_ORDER = { failed: 0, imported: 1 };

type Filter = 'all' | 'failed';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'failed', label: 'Failed' },
];

const ACTION = { failed: 'See why', imported: 'View details' };

const sortValue = (r: ImportRecord, key: SortKey): string | number => {
  switch (key) {
    case 'duplicates':
      return r.duplicateCodes.length;
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
  records: ImportRecord[] | null;
  error: string | null;
  onRetry: () => void;
  onView: (record: ImportRecord) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'importedAt', dir: -1 });
  const [filter, setFilter] = useState<Filter>('all');
  const [dates, setDates] = useState<DateRange>(ANY_DATE);
  const anyDate = isAnyDate(dates);

  const dated = useMemo(() => records?.filter((r) => inDateRange(r.importedAt, dates)) ?? [], [records, dates]);
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
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'importedAt' ? -1 : 1 }));

  return (
    <section aria-labelledby="history-heading" className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
        <h2 id="history-heading" className="text-base font-semibold">
          Import history
        </h2>
        {records && records.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <DateFilter value={dates} onChange={setDates} label="Import date" compact />
            <div role="group" aria-label="Show imports" className="flex flex-wrap gap-1">
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
                  {f.label}
                  <span className="font-mono text-xs">{count(f.key)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error ? (
        <div role="alert" className="border-t px-5 py-8">
          <p className="font-medium text-destructive">Import history could not be loaded.</p>
          <p className="mt-1 text-muted-foreground">{error} Your imported parcels are not affected.</p>
          <Button variant="outline" className="mt-4" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : sorted && sorted.length === 0 && records!.length > 0 ? (
        <div className="border-t px-5 py-10">
          <p className="font-medium">
            {anyDate ? 'No failed imports.' : `No ${filter === 'failed' ? 'failed ' : ''}imports ${rangePhrase(dates)}.`}
          </p>
          <p className="mt-1 text-muted-foreground">
            <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={showAll}>
              Show all imports
            </button>
          </p>
        </div>
      ) : sorted && sorted.length === 0 ? (
        <div className="border-t px-5 py-10">
          <p className="font-medium">No imports yet</p>
          <p className="mt-1 text-muted-foreground">
            Upload an export or use Scan Folder Now. Each confirmed import is listed here with its result.
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
                      {c.label}
                      <Icon className="size-3.5" aria-hidden />
                    </button>
                  </TableHead>
                );
              })}
              <TableHead>
                <span className="sr-only">Actions</span>
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
                    <TableCell>{r.source === 'manual' ? 'Manual upload' : 'Watched folder'}</TableCell>
                    <TableCell className="font-mono">{formatDateTime(r.importedAt)}</TableCell>
                    {r.status === 'failed' ? (
                      // Nothing was read, so counts would only look like an empty file.
                      <TableCell colSpan={2} className="text-right text-muted-foreground">
                        Not imported
                      </TableCell>
                    ) : (
                      <>
                        <TableCell className="text-right font-mono">{r.newRecords}</TableCell>
                        <TableCell className="text-right font-mono">{r.duplicateCodes.length}</TableCell>
                      </>
                    )}
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="link" size="sm" onClick={() => onView(r)} aria-label={`${ACTION[r.status]} for ${r.fileName}`}>
                        {ACTION[r.status]}
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
