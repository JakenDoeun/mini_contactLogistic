import Link from 'next/link';
import { FolderOpen, FolderSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { MonitorState, MonitorStatus } from '@/lib/mock/import-service';
import { cn, formatDateTime } from '@/lib/utils';
import { StatusBadge } from './status-badge';

const BAND: Record<MonitorStatus, string> = {
  active: 'bg-success-tint',
  inactive: 'bg-secondary',
  error: 'bg-destructive-tint',
  preview: 'bg-info-tint',
};

const SUMMARY: Record<MonitorStatus, string> = {
  preview: 'Not watching yet. Monitoring starts once the backend service is connected.',
  active: 'Watching for new exports.',
  inactive: 'Turned off. New exports in this folder are not picked up.',
  error: 'Something is wrong with the folder.',
};

const OUTCOME = {
  waiting: 'text-info',
  imported: 'text-success',
  failed: 'text-destructive',
};

export function FolderMonitor({
  state,
  error,
  settingsLink = true,
  onScan,
}: {
  state: MonitorState | null;
  error: string | null;
  /** Off on the Settings page itself. */
  settingsLink?: boolean;
  /** Scan Folder Now. Absent where there is no review flow to open (Settings). */
  onScan?: () => void;
}) {
  const detections = state?.activity.slice(0, 3) ?? [];

  return (
    <section aria-labelledby="monitor-heading" className="overflow-hidden rounded-md border bg-card">
      {/* The status owns the top band so the folder's health reads before any detail. */}
      <div className={cn('flex flex-wrap items-center justify-between gap-2 px-5 py-3', state ? BAND[state.status] : 'bg-secondary')}>
        <h2 id="monitor-heading" className="flex items-center gap-2 text-base font-semibold">
          <FolderOpen className="size-4 text-muted-foreground" aria-hidden />
          Folder monitoring
        </h2>
        {state && (
          <span className="flex items-center gap-1.5">
            {state.simulated && state.status !== 'preview' && (
              <Badge variant="info" title="Sample state for this preview">
                Simulated
              </Badge>
            )}
            <StatusBadge status={state.status} className="bg-card/70" />
          </span>
        )}
      </div>

      <div className="px-5 pt-3 pb-5">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}

        {!state && !error && (
          <div className="space-y-3" aria-busy="true" aria-label="Loading folder status">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}

        {state && (
          <>
            <p className={cn('text-sm', state.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
              {state.statusDetail ?? SUMMARY[state.status]}
            </p>

            {onScan && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                <Button onClick={onScan}>
                  <FolderSearch aria-hidden />
                  Scan Folder Now
                </Button>
                {state.waiting > 0 && (
                  <p className="text-sm font-medium text-info">
                    {state.waiting} file{state.waiting === 1 ? '' : 's'} waiting for review
                  </p>
                )}
              </div>
            )}

            <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Folder</dt>
              <dd className="font-mono break-all">{state.folderPath}</dd>
              <dt className="text-muted-foreground">Checks</dt>
              <dd>Every {state.checkIntervalSeconds} seconds</dd>
              <dt className="text-muted-foreground">Last detected</dt>
              <dd className="truncate font-mono" title={state.lastDetectedFile ?? undefined}>
                {state.lastDetectedFile ?? 'Nothing yet'}
              </dd>
            </dl>
            {settingsLink && (
            <Link
              href="/settings"
              className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline sm:min-h-8"
            >
              {state.status === 'inactive' ? 'Turn on in Settings' : 'Change folder in Settings'}
            </Link>
            )}

            <h3 className="mt-3 border-t pt-4 text-xs font-medium text-muted-foreground">
              {state.simulated ? 'Recent detections (sample)' : 'Recent detections'}
            </h3>
            {detections.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing detected yet. New exports saved to the folder will show up here.</p>
            ) : (
              <ol className="mt-1 divide-y text-sm">
                {detections.map((a) => (
                  <li key={a.at + a.fileName} className="py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate font-mono" title={a.fileName}>
                        {a.fileName}
                      </p>
                      <time dateTime={a.at} className="shrink-0 font-mono text-xs text-muted-foreground">
                        {formatDateTime(a.at)}
                      </time>
                    </div>
                    <p className={cn('text-xs', OUTCOME[a.outcome])}>{a.note}</p>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </section>
  );
}
