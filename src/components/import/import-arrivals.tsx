'use client';

import { useCallback, useEffect, useState } from 'react';
import { summarizeDay, type ImportRecord } from '@/lib/import-logic';
import { getImportHistory, getMonitorState, type MonitorState, type PreviewMode } from '@/lib/mock/import-service';
import { useSettings } from '@/lib/mock/use-settings';
import { cn } from '@/lib/utils';
import { DaySummary } from './day-summary';
import { FolderMonitor } from './folder-monitor';
import { ImportDetailSheet } from './import-detail-sheet';
import { ImportFlow, type FlowRequest } from './import-flow';
import { ImportHistory } from './import-history';
import { LatestImport } from './latest-import';
import { UploadPanel } from './upload-panel';

const newestFirst = (records: ImportRecord[]) => [...records].sort((a, b) => b.importedAt.localeCompare(a.importedAt));

export function ImportArrivals({ mode }: { mode: PreviewMode }) {
  const settings = useSettings();
  const [history, setHistory] = useState<ImportRecord[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [monitor, setMonitor] = useState<MonitorState | null>(null);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [flow, setFlow] = useState<FlowRequest | null>(null);
  const [open, setOpen] = useState<ImportRecord | null>(null);

  const loadHistory = useCallback(() => {
    setHistory(null);
    setHistoryError(null);
    getImportHistory(mode).then(setHistory, (e: Error) => setHistoryError(e.message));
  }, [mode]);

  const loadMonitor = useCallback(() => {
    getMonitorState(mode).then(setMonitor, (e: Error) => setMonitorError(e.message));
  }, [mode]);

  useEffect(() => {
    loadHistory();
    setMonitor(null);
    loadMonitor();
  }, [loadHistory, loadMonitor]);

  const summary = history ? summarizeDay(history, new Date()) : null;
  // undefined while loading, null when there is nothing yet.
  const latest = history ? (newestFirst(history)[0] ?? null) : undefined;

  return (
    <>
      <PageHeading history={history} waiting={monitor?.waiting ?? 0} />

      {/* Two ways in, one review: a file staff choose, or one found in the watched folder. */}
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <UploadPanel disabled={!!flow} onPick={(meta) => setFlow({ kind: 'file', meta })} />
          {/* Without history the totals are unknown; the history panel explains the error. */}
          {!historyError && (
            <>
              <DaySummary summary={summary} />
              <LatestImport record={latest} onView={setOpen} />
            </>
          )}
        </div>
        <FolderMonitor state={monitor} error={monitorError} onScan={() => setFlow({ kind: 'scan' })} />
      </div>

      <div className="mt-8">
        <ImportHistory records={history} error={historyError} onRetry={loadHistory} onView={setOpen} />
      </div>

      <ImportFlow
        request={flow}
        mode={mode}
        blockDuplicateFiles={settings?.duplicateFile === 'block'}
        simulated={monitor?.simulated ?? true}
        onClose={() => {
          setFlow(null);
          loadMonitor(); // waiting count and recent activity change after a review
        }}
        onRecord={(r) => setHistory((h) => (h ? [r, ...h] : h))}
        onView={(r) => {
          setFlow(null);
          setOpen(r);
        }}
      />
      <ImportDetailSheet record={open} onClose={() => setOpen(null)} />
    </>
  );
}

function PageHeading({ history, waiting }: { history: ImportRecord[] | null; waiting: number }) {
  const newest = history?.length ? newestFirst(history)[0] : null;
  const today = history?.filter((r) => new Date(r.importedAt).toDateString() === new Date().toDateString()) ?? [];

  const health = !history
    ? null
    : newest?.status === 'failed'
      ? { tone: 'bg-destructive-tint text-destructive', text: 'Last file did not import' }
      : waiting
        ? { tone: 'bg-info-tint text-info', text: `${waiting} folder file${waiting === 1 ? '' : 's'} waiting for review` }
        : today.length
          ? { tone: 'bg-success-tint text-success', text: 'All clear today' }
          : { tone: 'bg-secondary text-muted-foreground', text: 'Nothing imported yet today' };

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">Import Arrivals</h1>
        <p className="mt-1 text-muted-foreground">
          Bring parcel arrivals into the branch records. Every file is reviewed and confirmed before it is imported.
        </p>
      </div>
      {health && (
        <p className={cn('flex items-center gap-2 self-start rounded-sm px-2.5 py-1 text-sm font-medium md:self-auto', health.tone)}>
          <span className="sr-only">Import status: </span>
          <span className="size-2 rounded-full bg-current" aria-hidden />
          {health.text}
        </p>
      )}
    </div>
  );
}
