'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { FolderMonitor } from '@/components/import/folder-monitor';
import { getFolder, saveFolderSettings, type FolderState } from '@/lib/import-api';
import { CHECK_INTERVALS } from '@/lib/settings-logic';
import { cn } from '@/lib/utils';

const label = (n: number) => (n < 60 ? `${n} seconds` : n === 60 ? '1 minute' : `${n / 60} minutes`);

/** The watched folder on the server (Phase 5). Automatic checks start off; only the admin account changes these. */
export function FolderSettings() {
  const [state, setState] = useState<FolderState | null>(null);
  const [draft, setDraft] = useState({ path: '', auto: false, intervalSeconds: 60 });
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const [reloadKey, setReloadKey] = useState(0);

  const adopt = (s: FolderState) => {
    setState(s);
    setDraft({ path: s.path ?? '', auto: s.auto, intervalSeconds: s.intervalSeconds });
  };
  useEffect(() => {
    getFolder().then(adopt, (e: Error) => setStatus({ kind: 'error', message: e.message }));
  }, []);

  const dirty = !!state && (draft.path !== (state.path ?? '') || draft.auto !== state.auto || draft.intervalSeconds !== state.intervalSeconds);
  const set = (patch: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStatus({ kind: 'idle' });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: 'saving' });
    try {
      adopt(await saveFolderSettings(draft));
      setStatus({ kind: 'saved' });
      setReloadKey((k) => k + 1);
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    }
  }

  const readOnly = !state?.isAdmin;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <form onSubmit={save} noValidate aria-labelledby="folder-heading" className="rounded-md border bg-card">
        <div className="px-5 pt-5 sm:px-6">
          <h2 id="folder-heading" className="text-base font-semibold">
            Watched folder
          </h2>
          <p className="mt-0.5 text-muted-foreground">
            Where staff save the courier export. Scan Folder Now on Import Arrivals checks it; files found still wait for review and confirmation.
          </p>
        </div>

        {!state ? (
          <div className="px-5 py-5 sm:px-6">
            {status.kind === 'error' ? <p role="alert" className="text-destructive">{status.message}</p> : <Skeleton className="h-32 w-full" />}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-5 px-5 py-5 sm:px-6">
              <div>
                <label htmlFor="field-folder-path" className="block font-medium">
                  Folder
                </label>
                <p id="hint-folder-path" className="mt-0.5 text-sm text-muted-foreground">
                  The full path as the branch computer sees it. The installer creates C:\Users\Public\Documents\Campus Branch Imports for this.
                </p>
                <Input
                  id="field-folder-path"
                  className="mt-1.5 font-mono"
                  value={draft.path}
                  onChange={(e) => set({ path: e.target.value })}
                  readOnly={readOnly}
                  spellCheck={false}
                  aria-describedby="hint-folder-path"
                />
              </div>

              <div className="flex items-start justify-between gap-4">
                <div>
                  <p id="auto-label" className="font-medium">
                    Automatic checks
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {draft.auto ? 'On: the folder is also checked on its own while the app runs.' : 'Off: files are found only when someone uses Scan Folder Now.'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.auto}
                  aria-labelledby="auto-label"
                  disabled={readOnly}
                  onClick={() => set({ auto: !draft.auto })}
                  className={cn(
                    'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors disabled:opacity-60 motion-reduce:transition-none',
                    draft.auto ? 'bg-primary' : 'bg-input',
                  )}
                >
                  <span className={cn('size-5 rounded-full bg-white transition-transform motion-reduce:transition-none', draft.auto ? 'translate-x-5' : 'translate-x-0.5')} />
                </button>
              </div>

              {draft.auto && (
                <div>
                  <label htmlFor="field-folder-interval" className="block font-medium">
                    Check every
                  </label>
                  <select
                    id="field-folder-interval"
                    value={draft.intervalSeconds}
                    disabled={readOnly}
                    onChange={(e) => set({ intervalSeconds: Number(e.target.value) })}
                    className="mt-1.5 h-11 w-full max-w-48 rounded-md border border-input bg-card px-3 text-sm sm:h-10"
                  >
                    {CHECK_INTERVALS.map((n) => (
                      <option key={n} value={n}>
                        {label(n)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t px-5 py-3 sm:px-6">
              {readOnly ? (
                <p className="text-sm text-muted-foreground">Only the admin account can change the watched folder.</p>
              ) : (
                <>
                  <Button type="submit" disabled={!dirty || status.kind === 'saving'}>
                    {status.kind === 'saving' ? 'Saving…' : 'Save changes'}
                  </Button>
                  {dirty && (
                    <Button type="button" variant="ghost" onClick={() => (adopt(state), setStatus({ kind: 'idle' }))}>
                      Discard
                    </Button>
                  )}
                </>
              )}
              <p aria-live="polite" className="text-sm">
                {status.kind === 'saved' && !dirty && (
                  <span className="inline-flex items-center gap-1.5 text-success">
                    <Check className="size-4" aria-hidden />
                    Saved
                  </span>
                )}
                {status.kind === 'error' && <span className="text-destructive">{status.message}</span>}
              </p>
            </div>
          </>
        )}
      </form>
      <FolderMonitor reloadKey={reloadKey} />
    </div>
  );
}
