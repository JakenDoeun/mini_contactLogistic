'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FolderOpen, FolderSearch, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { dismissFolderFile, getFolder, scanFolder, type DetectedFile, type FolderState, type ScanResult } from '@/lib/import-api';
import { cn, formatBytes, formatDateTime } from '@/lib/utils';
import { StatusBadge } from './status-badge';
import { useT, type MessageKey } from '@/lib/i18n-react';

type T = ReturnType<typeof useT>;

type Health = 'active' | 'manual' | 'inactive' | 'error';

const BAND: Record<Health, string> = {
  active: 'bg-success-tint',
  manual: 'bg-secondary',
  inactive: 'bg-secondary',
  error: 'bg-destructive-tint',
};

const every = (s: number, t: T) => (s < 60 ? t('monitor.everySeconds', { count: s }) : t('monitor.everyMinutes', { count: s / 60 }));

// Khmer has no capitals, so this only changes English.
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function health(s: FolderState, t: T): { status: Health; text: string } {
  if (!s.path) return { status: 'inactive', text: t('monitor.noFolder') };
  if (s.lastScan && !s.lastScan.ok) return { status: 'error', text: s.lastScan.message ?? t('monitor.lastFailed') };
  if (!s.auto) return { status: 'manual', text: t('monitor.manual') };
  return { status: 'active', text: t('monitor.active', { every: every(s.intervalSeconds, t) }) };
}

function scanSummary(r: ScanResult, t: T) {
  if (!r.ok) return r.message ?? t('monitor.scanFailed');
  return [
    r.added ? t('monitor.newFiles', { count: r.added }) : t('monitor.noNew'),
    r.writing.length > 0 && t('monitor.writing', { count: r.writing.length }),
    r.unreadable.length > 0 && t('monitor.unreadable', { count: r.unreadable.length }),
    r.tooLarge.length > 0 && t('monitor.tooLarge', { count: r.tooLarge.length }),
  ]
    .filter(Boolean)
    .join(' ');
}

/** What a found file needs next, and the button that does it. */
function fileStatus(f: DetectedFile): { note: MessageKey; tone: string; action?: MessageKey; review?: boolean } {
  if (f.state === 'unreadable') return { note: 'monitor.file.unreadable', tone: 'text-warning' };
  if (f.state === 'imported')
    return { note: f.importStatus === 'imported' ? 'monitor.file.imported' : 'monitor.file.sameContent', tone: 'text-success', action: 'history.action.details' };
  if (f.importStatus === 'checked') return { note: 'monitor.file.started', tone: 'text-info', action: 'history.action.continue' };
  if (f.importStatus === 'failed') return { note: 'monitor.file.failed', tone: 'text-destructive', action: 'history.action.why' };
  if (f.importStatus === 'no_eligible_rows') return { note: 'monitor.file.noShopee', tone: 'text-muted-foreground', action: 'history.action.details' };
  return { note: 'monitor.file.waiting', tone: 'text-info', action: 'monitor.review', review: true };
}

/**
 * The watched folder: its health, Scan Folder Now and the files waiting for review (Import Arrivals). On Settings it
 * shows the health only. `reloadKey` changes when something elsewhere may have changed the list (a review closed).
 */
export function FolderMonitor({
  reloadKey = 0,
  onReview,
  onOpenImport,
}: {
  reloadKey?: number;
  /** Check a waiting file and open its review. Absent on Settings, which shows no file list. */
  onReview?: (file: DetectedFile) => void;
  onOpenImport?: (importId: number) => void;
}) {
  const t = useT();
  const [state, setState] = useState<FolderState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyFile, setBusyFile] = useState<number | null>(null);
  const onImportPage = !!onReview;

  const load = useCallback(() => {
    setError(null);
    getFolder().then(setState, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load, reloadKey]);

  async function scan() {
    setScanning(true);
    setNote(null);
    try {
      const { result, ...next } = await scanFolder();
      setState(next);
      setNote({ ok: result.ok, text: scanSummary(result, t) });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setScanning(false);
    }
  }

  async function dismiss(f: DetectedFile) {
    setBusyFile(f.id);
    setNote(null);
    try {
      await dismissFolderFile(f.id);
      load();
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusyFile(null);
    }
  }

  const h = state ? health(state, t) : null;
  const waiting = state?.files.filter((f) => f.state === 'waiting' && !f.importStatus).length ?? 0;

  return (
    <section aria-labelledby="monitor-heading" className="overflow-hidden rounded-md border bg-card">
      {/* The status owns the top band so the folder's health reads before any detail. */}
      <div className={cn('flex flex-wrap items-center justify-between gap-2 px-5 py-3', h ? BAND[h.status] : 'bg-secondary')}>
        <h2 id="monitor-heading" className="flex items-center gap-2 text-base font-semibold">
          <FolderOpen className="size-4 text-muted-foreground" aria-hidden />
          {t('folder.title')}
        </h2>
        {h && <StatusBadge status={h.status} className="bg-card/70" />}
      </div>

      <div className="px-5 pt-3 pb-5">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}

        {!state && !error && (
          <div className="space-y-3" aria-busy="true" aria-label={t('monitor.loading')}>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}

        {state && h && (
          <>
            <p className={cn('text-sm', h.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{h.text}</p>

            {onImportPage && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                <Button onClick={scan} disabled={scanning || !state.path}>
                  {scanning ? <Loader className="animate-spin motion-reduce:animate-none" aria-hidden /> : <FolderSearch aria-hidden />}
                  {scanning ? t('monitor.scanning') : t('monitor.scan')}
                </Button>
                {waiting > 0 && <p className="text-sm font-medium text-info">{t('monitor.waiting', { count: waiting })}</p>}
              </div>
            )}
            <p aria-live="polite" className={cn('text-sm', note && 'mt-2', note && !note.ok && 'text-destructive')}>
              {note?.text}
            </p>

            <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t('folder.field')}</dt>
              <dd className="font-mono break-all">{state.path ?? t('monitor.notChosen')}</dd>
              <dt className="text-muted-foreground">{t('monitor.automatic')}</dt>
              <dd>{state.auto ? cap(every(state.intervalSeconds, t)) : t('common.off')}</dd>
              <dt className="text-muted-foreground">{t('monitor.lastCheck')}</dt>
              <dd>
                {state.lastScan ? (
                  <>
                    <time dateTime={state.lastScan.at} className="font-mono">
                      {formatDateTime(state.lastScan.at)}
                    </time>{' '}
                    <span className="text-muted-foreground">({state.lastScan.by === 'auto' ? t('monitor.byAuto') : t('monitor.scan')})</span>
                  </>
                ) : (
                  t('monitor.notYet')
                )}
              </dd>
            </dl>
            {onImportPage && (
              <Link
                href="/settings"
                className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline sm:min-h-8"
              >
                {state.path ? t('monitor.change') : t('monitor.chooseIn')}
              </Link>
            )}

            {onImportPage && (
              <>
                <h3 className="mt-3 border-t pt-4 text-xs font-medium text-muted-foreground">{t('monitor.files')}</h3>
                {state.files.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">{t('monitor.nothing')}</p>
                ) : (
                  <ul className="mt-1 divide-y text-sm">
                    {state.files.map((f) => {
                      const s = fileStatus(f);
                      return (
                        <li key={f.id} className="py-2">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="min-w-0 truncate font-mono" title={f.fileName}>
                              {f.fileName}
                            </p>
                            <time dateTime={f.modifiedAt} className="shrink-0 font-mono text-xs text-muted-foreground">
                              {formatDateTime(f.modifiedAt)}
                            </time>
                          </div>
                          <p className={cn('text-xs', s.tone)}>
                            {t(s.note)} <span className="text-muted-foreground">· {formatBytes(f.sizeBytes)}</span>
                          </p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {s.action && (
                              <Button
                                size="sm"
                                variant={s.review ? 'default' : 'outline'}
                                disabled={busyFile === f.id}
                                onClick={() => (s.review || !f.importId ? onReview(f) : onOpenImport?.(f.importId))}
                                aria-label={t('monitor.actionFor', { action: t(s.action), file: f.fileName })}
                              >
                                {t(s.action)}
                              </Button>
                            )}
                            {f.state !== 'imported' && f.importStatus !== 'checked' && (
                              <Button size="sm" variant="ghost" disabled={busyFile === f.id} onClick={() => dismiss(f)} aria-label={t('monitor.takeOffFor', { file: f.fileName })}>
                                {t('monitor.takeOff')}
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
