// Sounds on the Notifications page (Phase 12, owner 2026-10-23): made by the browser's own tone maker, so there is no
// audio file to load or license. A soft rising chime when a run finishes; three short, lower beeps when it needs
// someone. Each device chooses whether it plays them; browsers allow sound only after the page was clicked once.
const KEY = 'cb.sounds';

export interface SoundPrefs {
  on: boolean;
  /** 0 to 1. */
  volume: number;
}
const DEFAULT: SoundPrefs = { on: true, volume: 0.6 };

export function soundPrefs(): SoundPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SoundPrefs> | null;
    return { on: saved?.on ?? DEFAULT.on, volume: typeof saved?.volume === 'number' ? Math.min(1, Math.max(0, saved.volume)) : DEFAULT.volume };
  } catch {
    return DEFAULT; // private window or blocked storage: sounds stay on at the default volume
  }
}

export function saveSoundPrefs(p: SoundPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // not kept on this device; it applies until the page closes
  }
}

let ctx: AudioContext | null = null;

/** One note: a quick fade in and out, so it never clicks. */
function note(freq: number, at: number, length: number, volume: number, wave: OscillatorType) {
  const osc = ctx!.createOscillator();
  const gain = ctx!.createGain();
  osc.type = wave;
  osc.frequency.value = freq;
  const start = ctx!.currentTime + at;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(ctx!.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

function play(kind: 'done' | 'attention', force = false) {
  const p = soundPrefs();
  if ((!p.on && !force) || typeof window === 'undefined' || !('AudioContext' in window)) return;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  const v = 0.25 * p.volume; // a sine at full scale is harsh; a quarter of it is a phone-notification level
  if (kind === 'done') {
    note(659.25, 0, 0.35, v, 'sine'); // E5
    note(880, 0.16, 0.5, v, 'sine'); // A5: rising, "all good"
  } else {
    for (const at of [0, 0.22, 0.44]) note(440, at, 0.14, v * 1.2, 'triangle'); // A4, three short beeps
  }
}

export const playDone = (force = false) => play('done', force);
export const playAttention = (force = false) => play('attention', force);
