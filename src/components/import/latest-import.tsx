import { FolderOpen, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ImportRecord } from '@/lib/import-logic';
import { formatDateTime } from '@/lib/utils';
import { StatusBadge } from './status-badge';

// The most recent single file, whatever day it arrived. Daily totals stay in DaySummary.
export function LatestImport({ record, onView }: { record: ImportRecord | null | undefined; onView: (r: ImportRecord) => void }) {
  const Source = record?.source === 'manual' ? Upload : FolderOpen;
  const action = record?.status === 'failed' ? 'See why' : 'View details';

  return (
    <section aria-labelledby="latest-heading" className="flex flex-col">
      <h2 id="latest-heading" className="mb-2 text-base font-semibold">
        Latest import
      </h2>
      <div className="flex flex-1 flex-col justify-center rounded-md border bg-card px-4 py-3 sm:px-5">
        {record === undefined ? (
          <Skeleton className="h-10 w-full" />
        ) : record === null ? (
          <p className="text-muted-foreground">No imports yet. Your first file will show up here.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
              <p className="truncate font-mono font-medium" title={record.fileName}>
                {record.fileName}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <Source className="size-3.5" aria-hidden />
                {record.source === 'manual' ? 'Manual upload' : 'Watched folder'}
                <span aria-hidden>·</span>
                <time dateTime={record.importedAt} className="font-mono">
                  {formatDateTime(record.importedAt)}
                </time>
                {record.status !== 'failed' && (
                  <>
                    <span aria-hidden>·</span>
                    {record.newRecords} added, {record.duplicateCodes.length} skipped
                  </>
                )}
              </p>
            </div>
            <StatusBadge status={record.status} />
            <Button
              variant={record.status === 'imported' ? 'outline' : 'default'}
              size="sm"
              onClick={() => onView(record)}
              aria-label={`${action} for ${record.fileName}`}
            >
              {action}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
