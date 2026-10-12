'use client';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { ImportRecord } from '@/lib/import-logic';
import { formatDateTime } from '@/lib/utils';
import { StatusBadge } from './status-badge';

export function ImportDetailSheet({ record, onClose }: { record: ImportRecord | null; onClose: () => void }) {
  return (
    <Sheet open={!!record} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>{record && <Detail record={record} />}</SheetContent>
    </Sheet>
  );
}

function Detail({ record }: { record: ImportRecord }) {
  const totals: [string, number][] = [
    ['Rows in file', record.totalRows],
    ['Records added', record.newRecords],
    ['Duplicates skipped', record.duplicateCodes.length],
  ];

  return (
    <>
      <header className="border-b px-6 pt-5 pb-4 pr-14">
        <SheetTitle className="font-mono break-all">{record.fileName}</SheetTitle>
        <SheetDescription asChild>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge status={record.status} />
            <span>{record.source === 'manual' ? 'Manual upload' : 'Watched folder'}</span>
            <span className="font-mono">{formatDateTime(record.importedAt)}</span>
          </div>
        </SheetDescription>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {record.status === 'failed' ? (
          <div role="alert" className="rounded-md bg-destructive-tint p-4 text-destructive">
            <p className="font-medium">Nothing from this file was imported.</p>
            <p className="mt-1">{record.failureReason}</p>
            <p className="mt-3 text-foreground">
              {record.source === 'manual'
                ? 'Fix the export, then upload it again.'
                : 'Once the file is ready, use Scan Folder Now and choose it again.'}
            </p>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-x-6 gap-y-3">
              {totals.map(([label, n]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-mono text-lg font-medium">{n}</dd>
                </div>
              ))}
            </dl>

            <section aria-labelledby="dup-heading" className="mt-8">
              <h3 id="dup-heading" className="font-semibold">
                Duplicates skipped <span className="font-mono font-normal text-muted-foreground">({record.duplicateCodes.length})</span>
              </h3>
              {record.duplicateCodes.length === 0 ? (
                <p className="mt-2 text-muted-foreground">No duplicates in this file.</p>
              ) : (
                <>
                  <p className="mt-1 text-muted-foreground">
                    Already in the branch records, so they were skipped. Their phone numbers and notification history were kept.
                  </p>
                  <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-2">
                    {record.duplicateCodes.map((code, i) => (
                      <li key={code + i}>{code}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
