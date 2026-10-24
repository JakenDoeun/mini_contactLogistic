'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Status = {
  lastBackupAt: string | null;
  failing: boolean;
  retentionDays: number;
  /** What the hourly deletion takes once the date moves on at midnight. */
  nextDeletion: { arrivedOn: string; parcels: number; customers: number };
  isAdmin: boolean;
};

/** 2026-10-17 → 17 Oct */
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const DAY_CHOICES = Array.from({ length: 14 }, (_, i) => i + 1);

/** Cambodia time, the branch's clock whatever the viewing device is set to (plan Revision 4). */
function when(iso: string) {
  const zone = { timeZone: 'Asia/Phnom_Penh' } as const;
  const day = (d: Date) => d.toLocaleDateString('en-CA', zone);
  const time = new Date(iso).toLocaleTimeString('en-GB', { ...zone, hour: '2-digit', minute: '2-digit' });
  if (day(new Date(iso)) === day(new Date())) return `today at ${time}`;
  return `${new Date(iso).toLocaleDateString('en-GB', { ...zone, day: 'numeric', month: 'short' })} at ${time}`;
}

/** Backups and data retention, on the real server (Phase 3). Backups are automatic; the button is for peace of mind. */
export function BackupCard() {
  const [status, setStatus] = useState<Status | null | 'failed'>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [days, setDays] = useState<number | null>(null);
  const [daysState, setDaysState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/backup', { cache: 'no-store' });
      setStatus(res.ok ? await res.json() : 'failed');
    } catch {
      setStatus('failed');
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function saveNow() {
    setSaving(true);
    setSaveError(false);
    try {
      const res = await fetch('/api/backup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      setSaveError(!res.ok);
    } catch {
      setSaveError(true);
    }
    await load();
    setSaving(false);
  }

  async function saveDays(e: React.FormEvent) {
    e.preventDefault();
    setDaysState('saving');
    try {
      const res = await fetch('/api/settings/retention', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ days }) });
      setDaysState(res.ok ? 'saved' : 'failed');
      if (res.ok) {
        setDays(null);
        await load();
      }
    } catch {
      setDaysState('failed');
    }
  }

  const s = typeof status === 'object' ? status : null;
  const chosen = days ?? s?.retentionDays ?? 7;

  return (
    <section aria-labelledby="backup-heading" className="rounded-md border bg-card">
      <div className="px-5 pt-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="backup-heading" className="text-base font-semibold">
            Backups and data
          </h2>
          <Badge variant="success" className="bg-card">
            On this server
          </Badge>
        </div>
        <p className="mt-0.5 text-muted-foreground">
          Backups are made automatically on this computer and kept for 7 days. They do not protect against losing the computer itself.
        </p>
      </div>

      <div className="flex flex-col gap-5 px-5 py-5 sm:px-6">
        <div aria-live="polite" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {status === null ? (
              <span className="text-muted-foreground">Checking backups…</span>
            ) : status === 'failed' ? (
              <span className="text-destructive">Backup status could not be loaded. Reload the page.</span>
            ) : s!.failing ? (
              <span className="font-medium text-destructive">Backups are failing. Tell the admin.</span>
            ) : s!.lastBackupAt ? (
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-4 text-success" aria-hidden />
                Last backup {when(s!.lastBackupAt)}
              </span>
            ) : (
              <span className="text-muted-foreground">No backup yet.</span>
            )}
            {saveError && <span className="mt-1 block text-destructive">The backup could not be saved. Try again, or tell the admin.</span>}
          </p>
          <Button type="button" variant="outline" onClick={saveNow} disabled={saving || status === null}>
            <Save aria-hidden />
            {saving ? 'Saving…' : 'Save backup'}
          </Button>
        </div>

        {s && (
          <form onSubmit={saveDays} className="flex flex-col gap-2 border-t pt-5">
            {s.isAdmin ? (
              <>
                <label htmlFor="retention-days" className="text-sm font-medium">
                  Customer data is deleted after
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    id="retention-days"
                    value={chosen}
                    onChange={(e) => (setDays(Number(e.target.value)), setDaysState('idle'))}
                    className="h-9 rounded-md border border-input bg-card px-3 text-base sm:text-sm"
                  >
                    {DAY_CHOICES.map((d) => (
                      <option key={d} value={d}>
                        {d} {d === 1 ? 'day' : 'days'}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" disabled={chosen === s.retentionDays || daysState === 'saving'}>
                    {daysState === 'saving' ? 'Saving…' : 'Save'}
                  </Button>
                  <span aria-live="polite" className="text-sm">
                    {daysState === 'saved' && <span className="text-success">Saved</span>}
                    {daysState === 'failed' && <span className="text-destructive">Not saved. Try again.</span>}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm">
                <span className="font-medium">Customer data is deleted after {s.retentionDays} {s.retentionDays === 1 ? 'day' : 'days'}.</span>{' '}
                Only the admin can change this.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Parcels, phone numbers and messages older than this are removed for good, and disappear from backups within 3 more days.
              Accounts and settings are kept.
            </p>
            {s.nextDeletion.parcels > 0 ? (
              <p className="flex items-start gap-2 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
                <Trash2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-semibold">After midnight:</span> {plural(s.nextDeletion.parcels, 'parcel')} for{' '}
                  {plural(s.nextDeletion.customers, 'customer')} that arrived on {dayLabel(s.nextDeletion.arrivedOn)} or earlier{' '}
                  {s.nextDeletion.parcels === 1 ? 'is' : 'are'} deleted, with their phone numbers and messages.
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing is due for deletion after midnight.</p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
