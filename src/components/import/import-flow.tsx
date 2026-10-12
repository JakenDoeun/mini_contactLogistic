'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, CircleCheck, FileSpreadsheet, FolderSearch, Loader, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PhoneText } from '@/components/parcels/parcel-status';
import { fileType, type FileMeta, type ImportPreview, type ImportRecord } from '@/lib/import-logic';
import {
  CHECK_STAGES,
  checkFile,
  confirmImport,
  scanFolder,
  type CheckStage,
  type DetectedFile,
  type PreviewMode,
} from '@/lib/mock/import-service';
import { cn, formatBytes, formatDateTime } from '@/lib/utils';

/** What started the flow: a file staff chose, or Scan Folder Now. Both go through the same review. */
export type FlowRequest = { kind: 'file'; meta: FileMeta } | { kind: 'scan' };

type Step =
  | { s: 'scanning' }
  | { s: 'scan-failed'; message: string }
  | { s: 'pick'; files: DetectedFile[]; selected: string | null }
  | { s: 'checking'; meta: FileMeta; stage: CheckStage; index: number }
  | { s: 'check-failed'; meta: FileMeta; record: ImportRecord }
  | { s: 'review'; preview: ImportPreview }
  | { s: 'saving'; preview: ImportPreview }
  | { s: 'done'; record: ImportRecord };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const FILE_STATUS: Record<DetectedFile['status'], { label: string; variant: 'info' | 'neutral' | 'warning' }> = {
  new: { label: 'New', variant: 'info' },
  imported: { label: 'Already imported', variant: 'neutral' },
  unreadable: { label: 'Cannot be read yet', variant: 'warning' },
};

export function ImportFlow({
  request,
  mode,
  blockDuplicateFiles,
  simulated,
  onClose,
  onRecord,
  onView,
}: {
  request: FlowRequest | null;
  mode: PreviewMode;
  /** Settings › Import rules: the same file content may not be imported twice. */
  blockDuplicateFiles: boolean;
  simulated: boolean;
  onClose: () => void;
  /** Every outcome that belongs in the history: an import, or a file that failed its checks. */
  onRecord: (record: ImportRecord) => void;
  onView: (record: ImportRecord) => void;
}) {
  const [step, setStep] = useState<Step | null>(null);
  const run = useRef(0); // a closed or restarted flow ignores late results
  const heading = useRef<HTMLHeadingElement>(null);
  const fromScan = request?.kind === 'scan';

  async function scan() {
    const id = ++run.current;
    setStep({ s: 'scanning' });
    try {
      const files = await scanFolder(mode);
      if (id === run.current) setStep({ s: 'pick', files, selected: files.find((f) => f.status === 'new')?.fileName ?? null });
    } catch (e) {
      if (id === run.current) setStep({ s: 'scan-failed', message: (e as Error).message });
    }
  }

  async function check(meta: FileMeta) {
    const id = ++run.current;
    const result = await checkFile(meta, mode, (stage, index) => id === run.current && setStep({ s: 'checking', meta, stage, index }));
    if (id !== run.current) return;
    if (result.ok) return setStep({ s: 'review', preview: result.preview });
    onRecord(result.record);
    setStep({ s: 'check-failed', meta, record: result.record });
  }

  async function confirm(preview: ImportPreview) {
    setStep({ s: 'saving', preview });
    const record = await confirmImport(preview);
    onRecord(record);
    setStep({ s: 'done', record });
  }

  useEffect(() => {
    if (!request) {
      run.current++;
      return setStep(null);
    }
    if (request.kind === 'scan') scan();
    else check(request.meta);
    // Each new request starts the flow over; scan and check read the latest mode themselves.
  }, [request]);

  // Each step replaces the buttons that were just pressed, so move focus to the new step's heading.
  useEffect(() => {
    heading.current?.focus();
  }, [step?.s]);

  const saving = step?.s === 'saving';
  const h = (text: string) => (
    <h3 ref={heading} tabIndex={-1} className="text-base font-semibold outline-none">
      {text}
    </h3>
  );

  return (
    <Sheet open={!!request} onOpenChange={(open) => !open && !saving && onClose()}>
      <SheetContent className="max-w-2xl" onEscapeKeyDown={(e) => saving && e.preventDefault()}>
        <header className="border-b px-6 pt-5 pb-4 pr-14">
          <SheetTitle>{fromScan ? 'Scan Folder Now' : 'Review upload'}</SheetTitle>
          <SheetDescription>
            Nothing is imported until you confirm. Tracking codes already in the branch records are skipped.
            {simulated && <span className="block text-info">Sample preview: files and rows are generated. Imported parcels are kept in this browser tab only, not in a database.</span>}
          </SheetDescription>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step?.s === 'scanning' && <Busy text="Looking in the watched folder…" />}

          {step?.s === 'scan-failed' && (
            <Problem heading={h('The folder could not be scanned')} message={step.message} />
          )}

          {step?.s === 'pick' && (
            <>
              {h(step.files.length ? 'Choose the file to import' : 'No export files in the folder')}
              {step.files.length === 0 ? (
                <p className="mt-1 text-muted-foreground">Save the export from the logistics system to the watched folder, then scan again.</p>
              ) : (
                <fieldset className="mt-3">
                  <legend className="sr-only">Files in the watched folder</legend>
                  <ul className="divide-y rounded-md border">
                    {step.files.map((f) => (
                      <li key={f.fileName}>
                        <label
                          className={cn(
                            'flex cursor-pointer items-start gap-3 px-4 py-3 has-[:checked]:bg-accent',
                            f.status === 'unreadable' && 'cursor-not-allowed opacity-70',
                          )}
                        >
                          <input
                            type="radio"
                            name="detected-file"
                            className="mt-1 size-4 accent-primary"
                            checked={step.selected === f.fileName}
                            disabled={f.status === 'unreadable'}
                            onChange={() => setStep({ ...step, selected: f.fileName })}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-sm" title={f.fileName}>
                              {f.fileName}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {fileType(f.fileName)} · {formatBytes(f.size)} · modified{' '}
                              <time dateTime={f.modifiedAt}>{formatDateTime(f.modifiedAt)}</time>
                              {f.status === 'unreadable' && ' · the export may still be writing it'}
                            </span>
                          </span>
                          <Badge variant={FILE_STATUS[f.status].variant}>{FILE_STATUS[f.status].label}</Badge>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}
            </>
          )}

          {step?.s === 'checking' && (
            <>
              <FileFacts meta={step.meta} />
              <ol aria-label="Checks" className="mt-5 space-y-2">
                {CHECK_STAGES.map((stage, i) => (
                  <li key={stage} className={cn('flex items-center gap-2', i > step.index && 'text-muted-foreground')}>
                    {i < step.index ? (
                      <Check className="size-4 text-success" aria-hidden />
                    ) : i === step.index ? (
                      <Loader className="size-4 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
                    ) : (
                      <span className="size-4" aria-hidden />
                    )}
                    {stage}
                    <span className="sr-only">{i < step.index ? ', done' : i === step.index ? ', in progress' : ''}</span>
                  </li>
                ))}
              </ol>
              <p aria-live="polite" className="sr-only">
                {step.stage}
              </p>
            </>
          )}

          {step?.s === 'check-failed' && (
            <>
              <FileFacts meta={step.meta} />
              <div className="mt-5">
                <Problem heading={h('This file did not pass the checks')} message={step.record.failureReason!}>
                  Nothing from it was imported. The attempt is listed in the import history.
                </Problem>
              </div>
            </>
          )}

          {(step?.s === 'review' || step?.s === 'saving') && (
            <Review preview={step.preview} heading={h('Check the file, then confirm')} blockDuplicateFiles={blockDuplicateFiles} />
          )}

          {step?.s === 'done' && (
            <div className="rounded-md bg-success-tint p-4">
              <div className="flex items-start gap-2 text-success">
                <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
                {h(`${plural(step.record.newRecords, 'new parcel')} imported`)}
              </div>
              <p className="mt-1 pl-7">
                {step.record.duplicateCodes.length
                  ? `${plural(step.record.duplicateCodes.length, 'tracking code')} already in the records ${step.record.duplicateCodes.length === 1 ? 'was' : 'were'} skipped.`
                  : 'No duplicates in this file.'}{' '}
                <span className="font-mono">{step.record.fileName}</span>
              </p>
              {simulated && <p className="mt-2 pl-7 text-sm text-info">Sample result: nothing was saved in this preview.</p>}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap gap-2 border-t px-6 py-4">
          {step?.s === 'pick' && step.files.length > 0 && (
            <Button
              disabled={!step.selected}
              onClick={() => {
                const f = step.files.find((x) => x.fileName === step.selected)!;
                check({ fileName: f.fileName, size: f.size, modifiedAt: f.modifiedAt, source: 'folder', fingerprint: f.fingerprint });
              }}
            >
              Review selected file
            </Button>
          )}
          {(step?.s === 'pick' || step?.s === 'scan-failed') && (
            <Button variant="outline" onClick={scan}>
              <FolderSearch aria-hidden />
              Scan again
            </Button>
          )}

          {step?.s === 'check-failed' && (
            <Button variant="outline" onClick={() => check(step.meta)}>
              Try again
            </Button>
          )}

          {(step?.s === 'review' || step?.s === 'saving') && (
            <ConfirmButton preview={step.preview} saving={saving} blocked={blockDuplicateFiles && !!step.preview.duplicateOf} onConfirm={confirm} />
          )}

          {step?.s === 'done' && (
            <Button variant="outline" onClick={() => onView(step.record)}>
              View details
            </Button>
          )}

          {fromScan && (step?.s === 'check-failed' || step?.s === 'review' || step?.s === 'done') && (
            <Button variant="outline" onClick={scan}>
              Back to folder files
            </Button>
          )}

          <Button variant="ghost" className="ml-auto" disabled={saving} onClick={onClose}>
            {step?.s === 'done' ? 'Done' : 'Cancel'}
          </Button>
        </footer>
      </SheetContent>
    </Sheet>
  );
}

function Busy({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-muted-foreground">
      <Loader className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      {text}
    </p>
  );
}

function Problem({ heading, message, children }: { heading: React.ReactNode; message: string; children?: React.ReactNode }) {
  return (
    <div role="alert" className="rounded-md bg-destructive-tint p-4 text-destructive">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {heading}
      </div>
      <p className="mt-1 pl-6">{message}</p>
      {children && <p className="mt-2 pl-6 text-foreground">{children}</p>}
    </div>
  );
}

function FileFacts({ meta }: { meta: FileMeta }) {
  return (
    <div className="flex items-center gap-3 rounded-md border px-4 py-3">
      <FileSpreadsheet className="size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm" title={meta.fileName}>
          {meta.fileName}
        </p>
        <p className="text-xs text-muted-foreground">
          {fileType(meta.fileName)} · {formatBytes(meta.size)} · modified <time dateTime={meta.modifiedAt}>{formatDateTime(meta.modifiedAt)}</time> ·{' '}
          {meta.source === 'manual' ? 'Manual upload' : 'Watched folder'}
        </p>
      </div>
    </div>
  );
}

function Review({ preview: p, heading, blockDuplicateFiles }: { preview: ImportPreview; heading: React.ReactNode; blockDuplicateFiles: boolean }) {
  const counts: [string, number, string?][] = [
    ['Rows in file', p.totalRows],
    ['New parcels to add', p.newCodes.length, 'text-success'],
    ['Already in records, skipped', p.duplicateCodes.length],
  ];
  return (
    <>
      {heading}
      <div className="mt-3">
        <FileFacts meta={p} />
      </div>

      <ul aria-label="Checks" className="mt-4 space-y-1.5 text-sm">
        <li className="flex items-center gap-2">
          <Check className="size-4 text-success" aria-hidden />
          The file can be read
        </li>
        <li className="flex items-center gap-2">
          <Check className="size-4 text-success" aria-hidden />
          The tracking-code column is there
        </li>
        {!p.duplicateOf && (
          <li className="flex items-center gap-2">
            <Check className="size-4 text-success" aria-hidden />
            This file has not been imported before
          </li>
        )}
      </ul>

      {p.duplicateOf && (
        <div role="alert" className={cn('mt-4 rounded-md p-4', blockDuplicateFiles ? 'bg-destructive-tint text-destructive' : 'bg-warning-tint text-warning')}>
          <p className="flex items-start gap-2 font-medium">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            This file was already imported on {formatDateTime(p.duplicateOf.importedAt)}
          </p>
          <p className="mt-1 pl-6 text-foreground">
            Same content as <span className="font-mono break-all">{p.duplicateOf.fileName}</span>.{' '}
            {blockDuplicateFiles
              ? 'Settings block importing the same file twice.'
              : 'Importing it again only adds tracking codes that are not in the records yet.'}
          </p>
        </div>
      )}

      <dl className="mt-5 grid grid-cols-3 overflow-hidden rounded-md border [&>div:not(:last-child)]:border-r">
        {counts.map(([label, n, tone]) => (
          <div key={label} className="px-4 py-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={cn('mt-0.5 font-mono text-xl font-medium', n > 0 && tone)}>{n}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-sm text-muted-foreground">
        Skipped tracking codes keep their phone numbers and notification history exactly as they are.
      </p>

      <h4 className="mt-6 text-sm font-semibold">
        Preview <span className="font-normal text-muted-foreground">(first {p.rows.length} of {p.totalRows} rows)</span>
      </h4>
      <div className="mt-2 rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Tracking code</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>
                <span className="sr-only">Result</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.rows.map((r) => (
              <TableRow key={r.tracking} className={cn(r.existing && 'text-muted-foreground')}>
                <TableCell className="font-mono">{r.tracking}</TableCell>
                <TableCell>{r.recipient}</TableCell>
                <TableCell>
                  <PhoneText raw={r.phone} />
                </TableCell>
                <TableCell className="text-right">
                  {r.existing ? <Badge>Skipped</Badge> : <Badge variant="success">New</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function ConfirmButton({
  preview,
  saving,
  blocked,
  onConfirm,
}: {
  preview: ImportPreview;
  saving: boolean;
  blocked: boolean;
  onConfirm: (p: ImportPreview) => void;
}) {
  const n = preview.newCodes.length;
  if (blocked) return <Button disabled>Blocked by Settings</Button>;
  if (n === 0) return <Button disabled>Nothing new to import</Button>;
  return (
    <Button onClick={() => onConfirm(preview)} disabled={saving}>
      {saving && <Loader className="animate-spin motion-reduce:animate-none" aria-hidden />}
      {saving ? 'Importing…' : `Import ${plural(n, 'new parcel')}`}
    </Button>
  );
}
