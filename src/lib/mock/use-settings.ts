'use client';

import { useSyncExternalStore } from 'react';
import { getSettings, subscribeSettings } from './settings-service';

// Kept apart from settings-service so server-rendered pages can import the plain functions.
/** Saved settings, or null during server render so forms never start from stale defaults. */
export const useSettings = () => useSyncExternalStore(subscribeSettings, getSettings, () => null);
