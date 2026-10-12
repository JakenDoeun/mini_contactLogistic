import type { DaySummary as Summary } from '@/lib/import-logic';
import { Skeleton } from '@/components/ui/skeleton';

// Totals for today only. The single latest file lives in its own block so the two are never confused.
export function DaySummary({ summary }: { summary: Summary | null }) {
  const cells: [string, keyof Summary][] = [
    ['Files imported', 'files'],
    ['New parcels', 'newRecords'],
    ['Duplicates skipped', 'duplicates'],
  ];
  return (
    <section aria-labelledby="today-heading" className="flex flex-col">
      <h2 id="today-heading" className="mb-2 text-base font-semibold">
        Today so far
      </h2>
      <dl className="grid flex-1 grid-cols-3 overflow-hidden rounded-md border bg-card [&>div:not(:last-child)]:border-r">
        {cells.map(([label, key]) => (
          <div key={key} className="px-4 py-3 sm:px-5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 font-mono text-xl font-medium">{summary ? summary[key] : <Skeleton className="mt-1 h-7 w-10" />}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
