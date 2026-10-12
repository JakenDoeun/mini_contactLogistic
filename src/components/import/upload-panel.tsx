'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ACCEPTED_EXTENSIONS, validateFile, type FileMeta } from '@/lib/import-logic';
import { cn } from '@/lib/utils';

/** Content fingerprint, so a re-exported copy under another name is still recognised. */
async function fingerprint(file: File) {
  // shortcut: crypto.subtle only exists on https (and localhost); plain http falls back to size + date.
  if (!crypto.subtle) return `meta-${file.size}-${file.lastModified}`;
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Picks one export file and hands it to the review flow. Nothing is checked or saved here. */
export function UploadPanel({ disabled, onPick }: { disabled: boolean; onPick: (meta: FileMeta) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function pick(files: FileList | null) {
    setRejection(null);
    if (!files?.length) return;
    if (files.length > 1) return setRejection('One file at a time, please. Drop a single export file.');
    const file = files[0];
    const error = validateFile(file);
    if (error) return setRejection(error);
    try {
      onPick({
        fileName: file.name,
        size: file.size,
        modifiedAt: new Date(file.lastModified).toISOString(),
        source: 'manual',
        fingerprint: await fingerprint(file),
      });
    } catch {
      setRejection(`${file.name} could not be opened. Close it in Excel, then try again.`);
    }
  }

  return (
    <section aria-labelledby="upload-heading" className="@container rounded-md border bg-card p-5 sm:p-6">
      <h2 id="upload-heading" className="text-base font-semibold">
        Upload an export
      </h2>
      <p className="mt-0.5 text-muted-foreground">You see what the file contains and confirm before anything is imported.</p>

      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        accept={ACCEPTED_EXTENSIONS.join(',')}
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = ''; // allow choosing the same file again
        }}
      />

      <div
        className={cn(
          'mt-5 flex flex-col items-start gap-4 rounded-md border border-dashed border-input bg-accent/40 px-5 py-6 transition-colors @md:flex-row @md:items-center @md:px-6',
          dragging && 'border-primary bg-accent',
        )}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) pick(e.dataTransfer.files);
        }}
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-accent text-primary" aria-hidden>
          <Upload className="size-5" strokeWidth={2} />
        </span>
        <div className="flex-1">
          <p className="text-base font-medium">{dragging ? 'Let go to add the file' : 'Drop the Excel or CSV export here'}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">.xlsx, .xls or .csv, up to 10 MB</p>
        </div>
        <Button onClick={() => input.current?.click()} disabled={disabled}>
          Choose file
        </Button>
      </div>

      {rejection && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {rejection}
        </p>
      )}
    </section>
  );
}
