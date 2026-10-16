'use client';

import { useEffect, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { FolderMonitor } from '@/components/import/folder-monitor';
import { BackupCard } from './backup-card';
import { PhoneSetupCard } from './phone-setup-card';
import { composeMessage } from '@/lib/parcel-logic';
import {
  CHECK_INTERVALS,
  DEFAULT_SETTINGS,
  columnError,
  folderError,
  gatewayUrlError,
  templateError,
  type Settings,
} from '@/lib/settings-logic';
import { getMonitorState, type MonitorState } from '@/lib/mock/import-service';
import { saveSettings } from '@/lib/mock/settings-service';
import { useSettings } from '@/lib/mock/use-settings';
import { cn } from '@/lib/utils';

export function SettingsView() {
  const settings = useSettings();
  const [monitor, setMonitor] = useState<MonitorState | null>(null);

  // Health follows the saved settings, so a save that turns monitoring off shows here at once.
  const watch = settings && [settings.watchedFolder, settings.checkIntervalSeconds, settings.monitoringEnabled].join('|');
  useEffect(() => {
    if (!watch) return;
    setMonitor(null);
    getMonitorState('normal').then(setMonitor);
  }, [watch]);

  return (
    <>
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">System Settings</h1>
      <p className="mt-1 text-muted-foreground">Folder monitoring, import rules and customer messages for this branch.</p>
      <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-info-tint px-4 py-2.5 text-sm text-info">
        <Badge variant="info" className="bg-card">
          Preview
        </Badge>
        Backups and data are on the server. The other settings are remembered in this browser only until the backend is connected.
      </p>

      {!settings ? (
        <div className="mt-6 flex flex-col gap-6" aria-busy="true" aria-label="Loading settings">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <BackupCard />
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <MonitoringSection settings={settings} />
            <FolderMonitor state={monitor} error={null} settingsLink={false} />
          </div>
          <ImportSection settings={settings} />
          <TemplateSection settings={settings} />
          <GatewaySection settings={settings} />
          <PhoneSetupCard />
        </div>
      )}
    </>
  );
}

type Errors<T> = Partial<Record<keyof T, string | null>>;

/** Local draft for one section: edits stay here until Save, so a half-typed path never takes effect. */
function useSection<K extends keyof Settings>(settings: Settings, keys: K[], validate: (d: Pick<Settings, K>) => Errors<Pick<Settings, K>>) {
  const pick = () => Object.fromEntries(keys.map((k) => [k, settings[k]])) as Pick<Settings, K>;
  const [draft, setDraft] = useState(pick);
  const [errors, setErrors] = useState<Errors<Pick<Settings, K>>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const dirty = JSON.stringify(draft) !== JSON.stringify(pick());

  const set = <F extends K>(key: F, value: Settings[F]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: null }));
    setStatus('idle');
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const found = validate(draft);
    setErrors(found);
    const first = Object.entries(found).find(([, v]) => v)?.[0];
    if (first) return document.getElementById(`field-${first}`)?.focus();
    setStatus('saving');
    await saveSettings(draft);
    setStatus('saved');
  }

  return { draft, set, errors, status, dirty, save, reset: () => (setDraft(pick()), setErrors({})) };
}

function SectionCard({
  id,
  title,
  description,
  badge,
  children,
  section,
}: {
  id: string;
  title: string;
  description: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  section: Pick<ReturnType<typeof useSection>, 'save' | 'dirty' | 'status' | 'reset'>;
}) {
  return (
    <form onSubmit={section.save} noValidate aria-labelledby={`${id}-heading`} className="rounded-md border bg-card">
      <div className="px-5 pt-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={`${id}-heading`} className="text-base font-semibold">
            {title}
          </h2>
          {badge}
        </div>
        <p className="mt-0.5 text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col gap-5 px-5 py-5 sm:px-6">{children}</div>
      <div className="flex flex-wrap items-center gap-3 border-t px-5 py-3 sm:px-6">
        <Button type="submit" disabled={!section.dirty || section.status === 'saving'}>
          {section.status === 'saving' ? 'Saving…' : 'Save changes'}
        </Button>
        {section.dirty && (
          <Button type="button" variant="ghost" onClick={section.reset}>
            Discard
          </Button>
        )}
        <p aria-live="polite" className="text-sm">
          {section.status === 'saved' && !section.dirty ? (
            <span className="inline-flex items-center gap-1.5 text-success">
              <Check className="size-4" aria-hidden />
              Saved in this browser
            </span>
          ) : section.dirty ? (
            <span className="text-muted-foreground">Unsaved changes</span>
          ) : null}
        </p>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: string;
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={`field-${name}`} className="block font-medium">
        {label}
      </label>
      {hint && (
        <p id={`hint-${name}`} className="mt-0.5 text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      <div className="mt-1.5">{children}</div>
      {error && (
        <p id={`error-${name}`} className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const described = (name: string, error?: string | null, hint = true) =>
  [hint && `hint-${name}`, error && `error-${name}`].filter(Boolean).join(' ') || undefined;

function MonitoringSection({ settings }: { settings: Settings }) {
  const s = useSection(settings, ['watchedFolder', 'checkIntervalSeconds', 'monitoringEnabled'], (d) => ({
    watchedFolder: folderError(d.watchedFolder),
  }));
  return (
    <SectionCard
      id="monitoring"
      title="Folder monitoring"
      description="Where the logistics system saves its arrival exports. Files found here still wait for staff to confirm them."
      section={s}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p id="monitoring-label" className="font-medium">
            Automatic monitoring
          </p>
          <p className="text-sm text-muted-foreground">
            {s.draft.monitoringEnabled ? 'On: the folder is checked for new exports.' : 'Off: only manual uploads come in.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={s.draft.monitoringEnabled}
          aria-labelledby="monitoring-label"
          onClick={() => s.set('monitoringEnabled', !s.draft.monitoringEnabled)}
          className={cn(
            'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors motion-reduce:transition-none',
            s.draft.monitoringEnabled ? 'bg-primary' : 'bg-input',
          )}
        >
          <span
            className={cn(
              'size-5 rounded-full bg-white transition-transform motion-reduce:transition-none',
              s.draft.monitoringEnabled ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      <Field name="watchedFolder" label="Watched folder" hint="The full path as this computer sees it." error={s.errors.watchedFolder}>
        <Input
          id="field-watchedFolder"
          value={s.draft.watchedFolder}
          onChange={(e) => s.set('watchedFolder', e.target.value)}
          aria-invalid={!!s.errors.watchedFolder}
          aria-describedby={described('watchedFolder', s.errors.watchedFolder)}
          spellCheck={false}
          className="font-mono"
        />
      </Field>

      <Field name="checkIntervalSeconds" label="Check every">
        <select
          id="field-checkIntervalSeconds"
          value={s.draft.checkIntervalSeconds}
          onChange={(e) => s.set('checkIntervalSeconds', Number(e.target.value))}
          className="h-11 w-full max-w-48 rounded-md border border-input bg-card px-3 text-sm sm:h-10"
        >
          {CHECK_INTERVALS.map((n) => (
            <option key={n} value={n}>
              {n < 60 ? `${n} seconds` : n === 60 ? '1 minute' : `${n / 60} minutes`}
            </option>
          ))}
        </select>
      </Field>
    </SectionCard>
  );
}

const ALWAYS = [
  'Rows whose tracking code is already in the branch records are skipped with a warning. The rest of the file still imports.',
  'Saved phone numbers and notification history are kept. A different phone number in a new file does not overwrite them.',
];

function ImportSection({ settings }: { settings: Settings }) {
  const s = useSection(settings, ['trackingColumn', 'phoneColumn', 'duplicateFile'], (d) => ({
    trackingColumn: columnError(d.trackingColumn),
    phoneColumn: columnError(d.phoneColumn),
  }));
  return (
    <SectionCard id="import" title="Import preferences" description="How export files are read and what happens with repeats." section={s}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="trackingColumn" label="Tracking code column" hint="Required. A file without it is not imported." error={s.errors.trackingColumn}>
          <Input
            id="field-trackingColumn"
            value={s.draft.trackingColumn}
            onChange={(e) => s.set('trackingColumn', e.target.value)}
            aria-invalid={!!s.errors.trackingColumn}
            aria-describedby={described('trackingColumn', s.errors.trackingColumn)}
          />
        </Field>
        <Field name="phoneColumn" label="Phone number column" hint="Used to group parcels by customer." error={s.errors.phoneColumn}>
          <Input
            id="field-phoneColumn"
            value={s.draft.phoneColumn}
            onChange={(e) => s.set('phoneColumn', e.target.value)}
            aria-invalid={!!s.errors.phoneColumn}
            aria-describedby={described('phoneColumn', s.errors.phoneColumn)}
          />
        </Field>
      </div>

      <fieldset>
        <legend className="font-medium">When the same file is imported again</legend>
        <p className="text-sm text-muted-foreground">Recognised by the file&apos;s fingerprint, even if it was renamed.</p>
        <div className="mt-2 flex flex-col gap-1">
          {(
            [
              ['warn', 'Warn, and let staff decide', 'Shows which earlier import it matches before anything is saved.'],
              ['block', 'Do not import it', 'The file is refused. Staff can still upload a corrected export.'],
            ] as const
          ).map(([value, label, help]) => (
            <label key={value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-1 py-1.5">
              <input
                type="radio"
                name="duplicateFile"
                value={value}
                checked={s.draft.duplicateFile === value}
                onChange={() => s.set('duplicateFile', value)}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                {label}
                <span className="block text-sm text-muted-foreground">{help}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <p className="font-medium">Always applied</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {ALWAYS.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}

const SAMPLE = { name: 'Sokha Chan', codes: ['CB4810276635', 'CB2291048871', 'CB7730192245'] };

function TemplateSection({ settings }: { settings: Settings }) {
  const s = useSection(settings, ['templates'], (d) => ({
    templates: templateError(d.templates.single) ?? templateError(d.templates.combined),
  }));
  const kinds = [
    ['single', 'One parcel', SAMPLE.codes.slice(0, 1)],
    ['combined', 'Several parcels', SAMPLE.codes],
  ] as const;
  const isDefault = JSON.stringify(s.draft.templates) === JSON.stringify(DEFAULT_SETTINGS.templates);

  return (
    <SectionCard
      id="templates"
      title="Default SMS message"
      description="The app picks the version by how many new parcels a customer has. Staff can still edit each message before it is queued."
      section={s}
    >
      <p className="text-sm text-muted-foreground">
        Placeholders: <code className="font-mono text-foreground">{'{name}'}</code> first name,{' '}
        <code className="font-mono text-foreground">{'{codes}'}</code> tracking codes (required),{' '}
        <code className="font-mono text-foreground">{'{count}'}</code> number of parcels.
      </p>
      {kinds.map(([kind, label, codes]) => {
        const text = s.draft.templates[kind];
        const error = templateError(text);
        const shown = s.errors.templates && error;
        const name = kind === 'single' ? 'templates' : 'templates-combined';
        return (
          <div key={kind} className="grid gap-3 lg:grid-cols-2">
            <Field name={name} label={label} error={shown ? error : null}>
              <textarea
                id={`field-${name}`}
                value={text}
                onChange={(e) => s.set('templates', { ...s.draft.templates, [kind]: e.target.value })}
                rows={4}
                aria-invalid={!!shown}
                aria-describedby={shown ? `error-${name}` : undefined}
                className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-sm"
              />
            </Field>
            <div>
              <p className="font-medium text-muted-foreground">Preview</p>
              <p className="mt-1.5 rounded-md bg-secondary px-3 py-2 text-sm">
                {error ? <span className="text-muted-foreground">Fix the message to see a preview.</span> : composeMessage(SAMPLE.name, [...codes], s.draft.templates)}
              </p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {error ? '' : `${composeMessage(SAMPLE.name, [...codes], s.draft.templates).length} characters`}
              </p>
            </div>
          </div>
        );
      })}
      {!isDefault && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => s.set('templates', DEFAULT_SETTINGS.templates)}>
            <RotateCcw aria-hidden />
            Restore the original wording
          </Button>
        </div>
      )}
    </SectionCard>
  );
}

function GatewaySection({ settings }: { settings: Settings }) {
  const s = useSection(settings, ['gatewayUrl', 'gatewaySim'], (d) => ({ gatewayUrl: gatewayUrlError(d.gatewayUrl) }));
  return (
    <SectionCard
      id="gateway"
      title="SMS gateway"
      description="An Android phone running an SMS gateway app sends the branch's messages through its SIM card."
      badge={<Badge>Not connected</Badge>}
      section={s}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="gatewayUrl" label="Gateway address" hint="Shown in the gateway app, for example http://192.168.1.20:8080." error={s.errors.gatewayUrl}>
          <Input
            id="field-gatewayUrl"
            type="url"
            value={s.draft.gatewayUrl}
            onChange={(e) => s.set('gatewayUrl', e.target.value)}
            aria-invalid={!!s.errors.gatewayUrl}
            aria-describedby={described('gatewayUrl', s.errors.gatewayUrl)}
            placeholder="http://"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <Field name="gatewaySim" label="Sending number (optional)" hint="So staff know which SIM customers see.">
          <Input
            id="field-gatewaySim"
            value={s.draft.gatewaySim}
            onChange={(e) => s.set('gatewaySim', e.target.value)}
            aria-describedby="hint-gatewaySim"
            inputMode="tel"
            className="font-mono"
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-md bg-secondary px-4 py-3 text-sm">
        <Button type="button" variant="outline" size="sm" disabled>
          Test connection
        </Button>
        <span className="text-muted-foreground">
          Testing and the access key need the backend. Until then every SMS in this app is simulated.
        </span>
      </div>
    </SectionCard>
  );
}
