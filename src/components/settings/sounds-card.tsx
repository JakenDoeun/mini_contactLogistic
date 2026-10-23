'use client';

import { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { playAttention, playDone, saveSoundPrefs, soundPrefs, type SoundPrefs } from '@/lib/sounds';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n-react';

/** Sounds on this device only (Phase 12): kept in this browser, so the office computer can chime while staff phones stay quiet. */
export function SoundsCard() {
  const t = useT();
  const [prefs, setPrefs] = useState<SoundPrefs | null>(null);
  useEffect(() => setPrefs(soundPrefs()), []); // read after the page loads: the server has no browser storage
  const update = (next: SoundPrefs) => {
    setPrefs(next);
    saveSoundPrefs(next);
  };

  return (
    <section aria-labelledby="sounds-heading" className="rounded-md border bg-card px-5 py-5 sm:px-6">
      <h2 id="sounds-heading" className="text-base font-semibold">
        {t('sounds.title')}
      </h2>
      <p className="mt-0.5 text-muted-foreground">
        {t('sounds.lead')}
      </p>
      {prefs && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4 sm:justify-start">
            <span id="sounds-label" className="font-medium">
              {t('sounds.on')}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.on}
              aria-labelledby="sounds-label"
              onClick={() => update({ ...prefs, on: !prefs.on })}
              className={cn(
                'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors motion-reduce:transition-none',
                prefs.on ? 'bg-primary' : 'bg-input',
              )}
            >
              <span className={cn('size-5 rounded-full bg-white transition-transform motion-reduce:transition-none', prefs.on ? 'translate-x-5' : 'translate-x-0.5')} />
            </button>
          </div>
          <div className="max-w-xs">
            <label htmlFor="sounds-volume" className="block font-medium">
              {t('sounds.volume')}
            </label>
            <input
              id="sounds-volume"
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={prefs.volume}
              disabled={!prefs.on}
              onChange={(e) => update({ ...prefs, volume: Number(e.target.value) })}
              className="mt-1.5 w-full accent-primary disabled:opacity-60"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => playDone(true)}>
              <Volume2 aria-hidden />
              {t('sounds.testDone')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => playAttention(true)}>
              <Volume2 aria-hidden />
              {t('sounds.testAttention')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
