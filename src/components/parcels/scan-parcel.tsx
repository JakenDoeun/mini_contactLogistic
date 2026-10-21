'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, ScanBarcode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { findByCode, normalizeCode, phoneGroup } from '@/lib/parcel-logic';
import { useParcelData, useParcelError } from '@/lib/parcel-service';
import { cameraSupport } from '@/lib/scanner/camera-barcode';
import { CameraScanner } from './camera-scanner';
import { ParcelDetail } from './parcel-detail';
import { SecureConnectionHelp } from './secure-connection-help';

const relatedLine = (n: number) =>
  n === 0 ? 'No other parcels on this phone number.' : `${n} more parcel${n === 1 ? '' : 's'} on this phone number.`;

export function ScanParcel() {
  const data = useParcelData();
  const loadError = useParcelError();
  const input = useRef<HTMLInputElement>(null);
  const cameraButton = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState('');
  const [scanned, setScanned] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [fromCamera, setFromCamera] = useState(false);
  const [insecure, setInsecure] = useState(false);
  // Known only in the browser; warn before staff reach for the camera.
  useEffect(() => setInsecure(cameraSupport() === 'insecure'), []);
  // The Dashboard's Scan Parcel links here with ?camera=1 so the camera opens at once. Dropped from the
  // address so going back or reloading lands on the page, not in the camera.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('camera') !== '1') return;
    url.searchParams.delete('camera');
    window.history.replaceState(null, '', url);
    setCamera(true);
  }, []);

  const parcel = scanned && data ? findByCode(data.parcels, scanned) : undefined;

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
      {!scanned && (
        <p className="mt-1 text-muted-foreground">
          Scan the barcode with the camera or a barcode scanner, or type the tracking code and press Enter.
        </p>
      )}

      <form
        className="mt-5 rounded-md border bg-card p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          lookup(value);
        }}
      >
        <label htmlFor="scan-input" className="font-medium">
          Tracking code
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:flex">
          <div className="relative col-span-2 flex-1">
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
            Find
          </Button>
          {/* The one filled button until a parcel is on screen; then Send SMS is, and this becomes Scan next. */}
          <Button ref={cameraButton} type="button" variant={scanned ? 'outline' : 'default'} className="h-12 sm:h-12" onClick={() => setCamera(true)}>
            <Camera aria-hidden />
            {scanned ? 'Scan next' : 'Camera'}
          </Button>
        </div>
        {insecure && (
          <div className="mt-3">
            <SecureConnectionHelp />
          </div>
        )}
      </form>

      {/* One short sentence for screen readers; the full result would be too long to announce. */}
      <p aria-live="polite" className="sr-only">
        {parcel && data ? `Found ${parcel.code}. ${relatedLine(phoneGroup(parcel, data.parcels).length - 1)}` : ''}
      </p>
      <div className="mt-5">
        {!scanned ? null : loadError ? (
          <p role="alert" className="rounded-md border bg-card px-5 py-6 text-destructive">
            The parcel list could not be loaded, so this code cannot be looked up. {loadError}
          </p>
        ) : !data ? (
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
          <ParcelDetail key={parcel.code} parcel={parcel} data={data} onSelect={lookup} label="Scanned" />
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
