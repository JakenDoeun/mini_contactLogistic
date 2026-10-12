import Link from 'next/link';
import type { Metadata } from 'next';
import { ImportArrivals } from '@/components/import/import-arrivals';
import { StatusBadge } from '@/components/import/status-badge';
import { PREVIEW_MODES, type PreviewMode } from '@/lib/mock/preview-modes';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Import Arrivals' };

export default async function ImportArrivalsPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const { preview } = await searchParams;
  const mode = (PREVIEW_MODES.find((p) => p.mode === preview)?.mode ?? 'normal') as PreviewMode;

  return (
    <>
      {/* Frontend preview only: remove this notice and the switcher with the mock services once the backend is connected. */}
      <p className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-info-tint px-4 py-2.5 text-sm text-info">
        <StatusBadge status="preview" className="bg-card" />
        Sample data only. Files and rows are generated, imports are kept in this browser tab until it reloads, and the folder is not being watched yet.
        <a href="#preview-states" className="font-medium underline underline-offset-4">
          Try other states
        </a>
      </p>

      <ImportArrivals key={mode} mode={mode} />

      <aside id="preview-states" className="mt-10 rounded-md border border-dashed border-input px-4 py-3 text-sm" aria-label="Preview states">
        <p className="text-muted-foreground">Preview states, to see how the page handles each situation:</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
          {PREVIEW_MODES.map((p) => (
            <Link
              key={p.mode}
              href={p.mode === 'normal' ? '/import-arrivals' : `/import-arrivals?preview=${p.mode}`}
              aria-current={p.mode === mode ? 'true' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-sm px-2 underline-offset-4 hover:underline sm:min-h-8',
                p.mode === mode ? 'bg-accent font-medium text-primary' : 'text-primary',
              )}
            >
              {p.label}
            </Link>
          ))}
        </p>
      </aside>
    </>
  );
}
