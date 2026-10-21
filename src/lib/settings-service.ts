// The shared settings from the server (Phase 10): export column headings, the duplicate-file rule and the SMS
// wording, the same for every staff member and device.
import { useSyncExternalStore } from 'react';
import { getAppSettings, putAppSettings } from '@/lib/import-api';
import { DEFAULT_TEMPLATES } from '@/lib/parcel-logic';
import type { Settings } from '@/lib/settings-logic';

let current: Settings | null = null;
let loading = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function load() {
  if (loading) return;
  loading = true;
  getAppSettings().then(
    (r) => {
      current = r.settings;
      notify();
    },
    () => {}, // the page keeps its loading state; the next page open tries again
  ).finally(() => (loading = false));
}

function subscribe(l: () => void) {
  if (!current) load();
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Saved settings, or null until they have loaded, so forms never start from stale defaults. */
export const useSettings = () => useSyncExternalStore(subscribe, () => current, () => null);

/** The SMS wording now, for code outside React; the defaults until the settings have loaded. */
export const currentTemplates = () => current?.templates ?? DEFAULT_TEMPLATES;

/** Saves on the server (admin only). Throws with a sentence staff can act on. */
export async function saveSettings(patch: Partial<Settings>) {
  current = (await putAppSettings(patch)).settings;
  notify();
}
