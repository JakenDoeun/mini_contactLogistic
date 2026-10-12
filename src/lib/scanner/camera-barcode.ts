// Camera barcode scanning, with no knowledge of parcels or screens: it turns a camera into text.
// This is the only file that knows the decoder is ZXing. To change decoders (for example the
// browser's own BarcodeDetector), replace startBarcodeScan here; callers stay the same.
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

export type CameraSupport = 'ok' | 'insecure' | 'unsupported';
export type CameraProblem = 'denied' | 'no-camera' | 'busy' | 'failed';

export interface ScanSession {
  /** Stops decoding and releases every camera track, so the camera light goes off. Safe to call twice. */
  stop(): void;
  /** The camera actually in use, for switching to the next one. */
  deviceId?: string;
}

// Parcel labels are mostly 1D codes; QR and Data Matrix cover newer carrier labels.
const HINTS = new Map<DecodeHintType, unknown>([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93,
      BarcodeFormat.ITF,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.CODABAR,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.DATA_MATRIX,
    ],
  ],
  [DecodeHintType.TRY_HARDER, true],
]);

/**
 * Whether this page may use the camera at all. Browsers only expose it on secure origins
 * (https, or localhost on the computer itself), so http over a LAN address is always 'insecure'.
 */
export function cameraSupport(): CameraSupport {
  if (!window.isSecureContext) return 'insecure';
  // Older browsers have no mediaDevices at all, whatever the types say.
  return typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'ok' : 'unsupported';
}

/** Maps a getUserMedia failure to something staff can act on. */
export function cameraProblem(error: unknown): CameraProblem {
  switch ((error as { name?: string })?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no-camera';
    case 'NotReadableError':
    case 'AbortError':
      return 'busy';
    default:
      return 'failed';
  }
}

/** Camera names are only available once permission was granted. */
export async function listCameras() {
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
}

/**
 * Starts the camera in `video` and calls onCode once with the first decoded text, then stops itself.
 * Rejects with the getUserMedia error (see cameraProblem). Give each call its own video element:
 * stopping clears the element's stream.
 */
export async function startBarcodeScan(video: HTMLVideoElement, onCode: (text: string) => void, deviceId?: string): Promise<ScanSession> {
  const reader = new BrowserMultiFormatReader(HINTS, { delayBetweenScanAttempts: 120 });
  let done = false;
  const controls = await reader.decodeFromConstraints(
    {
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
        // Labels are small: ask for HD so thin bars stay sharp. Browsers fall back if unsupported.
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    },
    video,
    (result, _error, c) => {
      if (!result || done) return; // no code in this frame yet
      done = true;
      c.stop();
      onCode(result.getText());
    },
  );
  const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
  return {
    stop: () => {
      done = true;
      controls.stop();
    },
    deviceId: track?.getSettings().deviceId,
  };
}
