'use client';

import { FolderOpen, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ImportListItem } from '@/lib/import-api';
import { formatDateTime } from '@/lib/utils';
import { importAction, importTime } from './import-history';
import { StatusBadge } from './status-badge';
import { useT } from '@/lib/i18n-react';

// The most recent single file, whatever day it arrived. Daily totals stay in DaySummary.
export function LatestImport({ record, onView }: { record: ImportListItem | null | undefined; onView: (r: ImportListItem) => void }) {
  const t = useT();
  const Source = record?.source === 'manual' ? Upload : FolderOpen;
  const action = record ? t(importAction(record.status)) : '';

  return (
    <section aria-labelledby="latest-heading" className="flex flex-col">
      <h2 id="latest-heading" className="mb-2 text-base font-semibold">
        {t('import.latest.title')}
      </h2>
      <div className="flex flex-1 flex-col justify-center rounded-md border bg-card px-4 py-3 sm:px-5">
        {record === undefined ? (
          <Skeleton className="h-10 w-full" />
        ) : record === null ? (
          <p className="text-muted-foreground">{t('import.latest.none')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
              <p className="truncate font-mono font-medium" title={record.fileName}>
                {record.fileName}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <Source className="size-3.5" aria-hidden />
                {record.source === 'manual' ? t('import.source.manual') : t('import.source.folder')}
                <span aria-hidden>·</span>
                <time dateTime={importTime(record)} className="font-mono">
                  {formatDateTime(importTime(record), t.locale)}
                </time>
                {record.status === 'imported' && (
                  <>
                    <span aria-hidden>·</span>
                    {t('import.latest.counts', { added: record.added, duplicates: record.duplicates })}
                  </>
                )}
              </p>
            </div>
            <StatusBadge status={record.status} />
            <Button
              variant={record.status === 'imported' ? 'outline' : 'default'}
              size="sm"
              onClick={() => onView(record)}
              aria-label={t('import.latest.actionFor', { action, file: record.fileName })}
            >
              {action}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
