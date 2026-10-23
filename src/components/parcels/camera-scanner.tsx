'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, SwitchCamera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cameraProblem, cameraSupport, listCameras, startBarcodeScan, type CameraProblem, type ScanSession } from '@/lib/scanner/camera-barcode';
import { SecureConnectionHelp } from './secure-connection-help';

type Problem = CameraProblem | 'insecure' | 'unsupported' | 'paused';
type State = { status: 'starting' } | { status: 'scanning'; slow: boolean } | { status: 'error'; problem: Problem };

const PROBLEM: Record<Exclude<Problem, 'insecure'>, { title: string; help: string; retry: boolean }> = {
  unsupported: {
    title: 'This browser cannot use the camera',
    help: 'Try the latest Chrome or Safari, or type the tracking code instead.',
    retry: false,
  },
  denied: {
    title: 'Camera access is blocked',
    help: 'Allow the camera for this site in the browser’s site settings (on iPhone: Settings › Safari › Camera), then try again. You can also type the code.',
    retry: true,
  },
  'no-camera': { title: 'No camera found', help: 'This device has no camera the browser can use. Type the tracking code instead.', retry: true },
  busy: { title: 'The camera is busy', help: 'Another app or tab is using it. Close that, then try again.', retry: true },
  paused: { title: 'Camera paused', help: 'The camera stops while the page is in the background.', retry: true },
  failed: { title: 'The camera could not start', help: 'Try again, or type the tracking code instead.', retry: true },
};

const SLOW_MS = 12_000;

/** Live camera barcode scanner. Calls onDetected once with the raw decoded text, then stops the camera. */
export function CameraScanner({
  open,
  onClose,
  onDetected,
  returnFocus,
  typeInstead = true,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (text: string) => void;
  /** Where focus goes when the scanner closes. A button, so the phone keyboard stays down. */
  returnFocus: React.RefObject<HTMLElement | null>;
  /** False where only the camera is offered (Verify on Contact by hand): the close button is labelled Cancel. */
  typeInstead?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="max-w-none sm:max-w-xl"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus.current?.focus();
        }}
      >{open && <Scanner onClose={onClose} onDetected={onDetected} typeInstead={typeInstead} />}</SheetContent>
    </Sheet>
  );
}

function Scanner({ onClose, onDetected, typeInstead }: { onClose: () => void; onDetected: (text: string) => void; typeInstead: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const current = useRef<string | undefined>(undefined);
  const [state, setState] = useState<State>({ status: 'starting' });
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const detected = useRef(onDetected);
  detected.current = onDetected;

  useEffect(() => {
    const support = cameraSupport();
    if (support !== 'ok') return setState({ status: 'error', problem: support });

    // A fresh <video> per start: stopping a scan empties its element, so a start that finishes
    // late (React re-running the effect, a camera switch) must never share one.
    const el = document.createElement('video');
    el.className = 'size-full object-cover';
    el.muted = true;
    el.playsInline = true; // iOS Safari shows no live preview without these two
    el.setAttribute('playsinline', '');
    el.setAttribute('aria-label', 'Camera preview');
    frame.current!.prepend(el);

    let session: ScanSession | undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      session?.stop();
    };
    setState({ status: 'starting' });

    startBarcodeScan(
      el,
      (text) => {
        if (stopped) return;
        stop();
        navigator.vibrate?.(60);
        detected.current(text);
      },
      deviceId,
    ).then(
      (s) => {
        if (stopped) return s.stop(); // closed while the camera was starting
        session = s;
        current.current = s.deviceId;
        setState({ status: 'scanning', slow: false });
        listCameras().then(setCameras, () => setCameras([]));
      },
      (e) => !stopped && setState({ status: 'error', problem: cameraProblem(e) }),
    );

    // The decoder cannot tell "no barcode" from "barcode it cannot read", so after a while offer help instead.
    const slow = setTimeout(() => setState((s) => (s.status === 'scanning' ? { ...s, slow: true } : s)), SLOW_MS);
    const onHide = () => {
      if (document.visibilityState !== 'hidden' || stopped) return;
      stop();
      setState({ status: 'error', problem: 'paused' });
    };
    document.addEventListener('visibilitychange', onHide);

    return () => {
      clearTimeout(slow);
      document.removeEventListener('visibilitychange', onHide);
      stop();
      el.remove();
    };
  }, [deviceId, attempt]);

  function switchCamera() {
    const index = cameras.findIndex((c) => c.deviceId === (current.current ?? deviceId));
    setDeviceId(cameras[(index + 1) % cameras.length].deviceId);
  }

  const insecure = state.status === 'error' && state.problem === 'insecure';
  const problem = state.status === 'error' && state.problem !== 'insecure' ? PROBLEM[state.problem] : null;

  return (
    <>
      <header className="border-b px-5 pt-5 pb-4 pr-14">
        <SheetTitle>Scan with camera</SheetTitle>
        <SheetDescription>Point the camera at the barcode on the parcel label.</SheetDescription>
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
        <div ref={frame} className="relative aspect-[3/4] max-h-[60vh] w-full overflow-hidden rounded-md bg-sidebar sm:aspect-video">
          {state.status === 'scanning' && (
            // Wide guide box sized for 1D barcodes; the dimmed surround is the only shadow use here.
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-[8%] top-1/2 h-[30%] -translate-y-1/2 rounded-md border-2 border-white shadow-[0_0_0_100vmax_rgb(0_0_0/0.4)]"
            />
          )}
          {state.status === 'starting' && (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white">Starting camera…</p>
          )}
          {(problem || insecure) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center text-white">
              <p className="font-medium">{problem?.title ?? 'Camera unavailable on this address'}</p>
            </div>
          )}
        </div>

        <div aria-live="polite" className="min-h-10 text-sm">
          {state.status === 'scanning' &&
            (state.slow ? (
              <p className="rounded-md bg-warning-tint px-3 py-2 text-warning">
                Still can&apos;t read a barcode. Hold the label flat and steady about 10–20 cm away, in good light, with the whole barcode inside
                the box. If the label is damaged, close this and type the code.
              </p>
            ) : (
              <p className="text-muted-foreground">Looking for a barcode. It is read automatically, no button needed.</p>
            ))}
          {insecure && <SecureConnectionHelp />}
          {problem && (
            <p role="alert" className="rounded-md bg-destructive-tint px-3 py-2 text-destructive">
              <span className="font-medium">{problem.title}.</span> {problem.help}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {problem?.retry && (
            <Button onClick={() => setAttempt((n) => n + 1)}>
              <RefreshCw aria-hidden />
              Try again
            </Button>
          )}
          {state.status === 'scanning' && cameras.length > 1 && (
            <Button variant="outline" onClick={switchCamera}>
              <SwitchCamera aria-hidden />
              Switch camera
            </Button>
          )}
          <Button variant={problem || insecure ? 'outline' : 'ghost'} onClick={onClose}>
            {typeInstead ? 'Type the code instead' : 'Cancel'}
          </Button>
        </div>
      </div>
    </>
  );
}
