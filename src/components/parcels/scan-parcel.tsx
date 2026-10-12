'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, ScanBarcode } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { normalizeCode, phoneGroup } from '@/lib/parcel-logic';
import { useParcelData } from '@/lib/mock/parcel-service';
import { cameraSupport } from '@/lib/scanner/camera-barcode';
import { CameraScanner } from './camera-scanner';
import { ParcelDetail } from './parcel-detail';
import { SecureConnectionHelp } from './secure-connection-help';

const relatedLine = (n: number) =>
  n === 0 ? 'No other parcels on this phone number.' : `${n} more parcel${n === 1 ? '' : 's'} on this phone number.`;

const SAMPLE_CODES = ['CB1187420096', 'CB5528814023', 'CB9014425560'];

export function ScanParcel() {
  const data = useParcelData();
  const input = useRef<HTMLInputElement>(null);
  const cameraButton = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState('');
  const [scanned, setScanned] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [fromCamera, setFromCamera] = useState(false);
  const [insecure, setInsecure] = useState(false);
  // Known only in the browser; warn before staff reach for the camera.
  useEffect(() => setInsecure(cameraSupport() === 'insecure'), []);

  const parcel = scanned ? data?.parcels.find((p) => p.code === scanned) : undefined;

  function lookup(raw: string, source: 'typed' | 'camera' = 'typed') {
    const code = normalizeCode(raw);
    if (!code) return;
    setValue(code);
    setScanned(code);
    setFromCamera(source === 'camera');
    // Keep the field ready for a USB scanner: the next scan replaces the selected text.
    // Skipped after a camera scan, where focusing would pop up the phone keyboard over the result.
    if (source === 'typed') requestAnimationFrame(() => input.current?.select());
  }

  return (
    <>
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">Scan Parcel</h1>
      <p className="mt-1 text-muted-foreground">
        Scan the barcode with the camera or a barcode scanner, or type the tracking code and press Enter. Other parcels on the same phone number show up with it.
      </p>

      <form
        className="mt-6 rounded-md border bg-card p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          lookup(value);
        }}
      >
        <label htmlFor="scan-input" className="font-medium">
          Tracking code
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <ScanBarcode className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              ref={input}
              id="scan-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="CB0000000000"
              className="h-12 pl-11 font-mono text-base sm:h-12"
            />
          </div>
          <Button type="submit" variant="outline" className="h-12 sm:h-12" disabled={!value.trim()}>
            Find parcel
          </Button>
          <Button ref={cameraButton} type="button" className="h-12 sm:h-12" onClick={() => setCamera(true)}>
            <Camera aria-hidden />
            Scan with camera
          </Button>
        </div>
        {insecure && (
          <div className="mt-3">
            <SecureConnectionHelp />
          </div>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Badge variant="info">Sample</Badge>
          Try a code from the sample data:
          {SAMPLE_CODES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => lookup(c)}
              className="inline-flex min-h-11 items-center font-mono text-primary underline-offset-4 hover:underline sm:min-h-8"
            >
              {c}
            </button>
          ))}
        </p>
      </form>

      {/* One short sentence for screen readers; the full result would be too long to announce. */}
      <p aria-live="polite" className="sr-only">
        {parcel && data ? `Found ${parcel.code}. ${relatedLine(phoneGroup(parcel, data.parcels).length - 1)}` : ''}
      </p>
      <div className="mt-6">
        {!scanned ? null : !data ? (
          <Skeleton className="h-40 w-full" />
        ) : !parcel ? (
          <div role="alert" className="rounded-md border bg-card px-5 py-6">
            <p className="font-medium">
              No parcel with code <span className="font-mono">{scanned}</span>
            </p>
            <p className="mt-1 text-muted-foreground">
              {fromCamera
                ? 'The camera read this code from the label. If it does not match the printed tracking code, scan again or type it.'
                : 'Check the code against the label.'}{' '}
              If the parcel arrived today, its file may not be imported yet.
            </p>
            {fromCamera && (
              <Button variant="outline" className="mt-4" onClick={() => setCamera(true)}>
                <Camera aria-hidden />
                Scan again
              </Button>
            )}
          </div>
        ) : (
          <ParcelDetail key={parcel.code} parcel={parcel} data={data} onSelect={lookup} label="Scanned parcel" />
        )}
      </div>

      <CameraScanner
        open={camera}
        onClose={() => setCamera(false)}
        onDetected={(text) => {
          setCamera(false);
          lookup(text, 'camera');
        }}
        returnFocus={cameraButton}
      />
    </>
  );
}
