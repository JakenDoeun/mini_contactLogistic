'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DaySummary as Summary } from '@/lib/import-logic';
import { listImports, type ImportListItem } from '@/lib/import-api';
import { cn } from '@/lib/utils';
import { CarrierTable } from '@/components/shared/carrier-table';
import { arrivalDay, phoneKey } from '@/lib/parcel-logic';
import { useParcelData } from '@/lib/parcel-service';
import { DaySummary } from './day-summary';
import { FolderMonitor } from './folder-monitor';
import { ImportFlow, type FlowRequest } from './import-flow';
import { ImportHistory } from './import-history';
import { LatestImport } from './latest-import';
import { UploadPanel } from './upload-panel';

const isToday = (iso: string | null) => !!iso && new Date(iso).toDateString() === new Date().toDateString();

function summarize(items: ImportListItem[]): Summary {
  const today = items.filter((r) => r.status === 'imported' && isToday(r.confirmedAt));
  return {
    files: today.length,
    newRecords: today.reduce((n, r) => n + r.added, 0),
    duplicates: today.reduce((n, r) => n + r.duplicates, 0),
  };
}

export function ImportArrivals() {
  const [history, setHistory] = useState<ImportListItem[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [flow, setFlow] = useState<FlowRequest | null>(null);
  const [folderKey, setFolderKey] = useState(0); // reloads the folder list after a review changes it

  const loadHistory = useCallback(() => {
    setHistoryError(null);
    listImports().then(setHistory, (e: Error) => setHistoryError(e.message));
  }, []);

  useEffect(loadHistory, [loadHistory]);

  const view = (r: ImportListItem) => setFlow({ kind: 'open', id: r.id });

  return (
    <>
      <PageHeading history={history} />

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <UploadPanel disabled={!!flow} onPick={(file) => setFlow({ kind: 'file', file })} />
          {/* Without history the totals are unknown; the history panel explains the error. */}
          {!historyError && (
            <>
              <DaySummary summary={history ? summarize(history) : null} />
              <TodayByCarrier />
              {/* undefined while loading, null when there is nothing yet; the list is newest first. */}
              <LatestImport record={history ? (history[0] ?? null) : undefined} onView={view} />
            </>
          )}
        </div>
        <FolderMonitor
          reloadKey={folderKey}
          onReview={(file) => setFlow({ kind: 'folder', file })}
          onOpenImport={(id) => setFlow({ kind: 'open', id })}
        />
      </div>

      <div className="mt-8">
        <ImportHistory records={history} error={historyError} onRetry={loadHistory} onView={view} />
      </div>

      <ImportFlow
        request={flow}
        onClose={() => {
          setFlow(null);
          setFolderKey((k) => k + 1);
        }}
        onChanged={loadHistory}
      />
    </>
  );
}

/** Today's arrivals as customers per carrier, and how the gateway phone's SIMs tell each group (Phase 12). */
function TodayByCarrier() {
  const data = useParcelData();
  if (!data) return null;
  const today = arrivalDay(new Date().toISOString());
  const phones = [...new Set(data.parcels.filter((p) => p.arrivalDate === today).map((p) => phoneKey(p.phone)).filter((k): k is string => k !== null))];
  if (!phones.length) return null;
  return (
    <section aria-labelledby="carriers-heading">
      <h2 id="carriers-heading" className="mb-2 text-base font-semibold">
        Today&apos;s customers by carrier
      </h2>
      <div className="rounded-md border bg-card px-4 py-2 sm:px-5">
        <CarrierTable items={phones.map((phone) => ({ phone }))} sims={data.gateway.sims} />
      </div>
    </section>
  );
}

function PageHeading({ history }: { history: ImportListItem[] | null }) {
  const newest = history?.[0];
  const waiting = history?.filter((r) => r.status === 'checked').length ?? 0;
  const today = history?.filter((r) => r.status === 'imported' && isToday(r.confirmedAt)) ?? [];

  const health = !history
    ? null
    : newest?.status === 'failed'
      ? { tone: 'bg-destructive-tint text-destructive', text: 'Last file did not import' }
      : waiting
        ? { tone: 'bg-info-tint text-info', text: `${waiting} file${waiting === 1 ? '' : 's'} waiting for review` }
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
