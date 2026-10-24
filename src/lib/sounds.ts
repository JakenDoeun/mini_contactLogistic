// Sounds on the Notifications page (Phase 12, owner 2026-10-23): made by the browser's own tone maker, so there is no
// audio file to load or license. A soft rising chime when a run finishes; three rounds of short, lower beeps when it
// needs someone. Each lasts about 3 seconds (owner asked for up to 4, 2026-10-24) so it is heard across the counter.
// Each device chooses whether it plays them; browsers allow sound only after the page was clicked once.
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
    // C5 E5 G5 C6, rising, "all good"; each rings on like a bell. Notes overlap, so each is quieter. Ends at 3 s.
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.18, 1.6 + i * 0.3, v * 0.7, 'sine'));
  } else {
    // A4, three short beeps, three times over 3 s.
    for (const round of [0, 1.2, 2.4]) for (const at of [0, 0.22, 0.44]) note(440, round + at, 0.14, v * 1.2, 'triangle');
  }
}

export const playDone = (force = false) => play('done', force);
export const playAttention = (force = false) => play('attention', force);
