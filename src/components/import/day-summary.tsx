'use client';

import type { DaySummary as Summary } from '@/lib/import-logic';
import { Skeleton } from '@/components/ui/skeleton';
import { useT, type MessageKey } from '@/lib/i18n-react';

// Totals for today only. The single latest file lives in its own block so the two are never confused.
export function DaySummary({ summary }: { summary: Summary | null }) {
  const t = useT();
  const cells: [MessageKey, keyof Summary][] = [
    ['import.today.files', 'files'],
    ['import.today.newParcels', 'newRecords'],
    ['import.today.duplicates', 'duplicates'],
  ];
  return (
    <section aria-labelledby="today-heading" className="flex flex-col">
      <h2 id="today-heading" className="mb-2 text-base font-semibold">
        {t('import.today.title')}
      </h2>
      <dl className="grid flex-1 grid-cols-3 overflow-hidden rounded-md border bg-card [&>div:not(:last-child)]:border-r">
        {cells.map(([label, key]) => (
          <div key={key} className="px-4 py-3 sm:px-5">
            <dt className="text-xs text-muted-foreground">{t(label)}</dt>
            <dd className="mt-0.5 font-mono text-xl font-medium">{summary ? summary[key] : <Skeleton className="mt-1 h-7 w-10" />}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
