// Mock settings API. Values are remembered in this browser until the backend stores them.
// shortcut: localStorage is per browser and per device; move to the settings endpoint when it exists.
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings-logic';

const KEY = 'campus-branch-settings';
let current: Settings | null = null;
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  if (current) return current;
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    const parsed = stored ? (JSON.parse(stored) as Partial<Settings>) : {};
    current = { ...DEFAULT_SETTINGS, ...parsed, templates: { ...DEFAULT_SETTINGS.templates, ...parsed.templates } };
  } catch {
    current = DEFAULT_SETTINGS; // blocked or corrupt storage: fall back to defaults
  }
  return current;
}

export function subscribeSettings(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export async function saveSettings(patch: Partial<Settings>) {
  await new Promise((r) => setTimeout(r, 400));
  current = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Still applied for this visit; it just will not survive a reload.
  }
  listeners.forEach((l) => l());
}
