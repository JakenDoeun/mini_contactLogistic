'use client';

import { useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { BackupCard } from './backup-card';
import { FolderSettings } from './folder-settings';
import { GatewayCard } from './gateway-card';
import { PhoneSetupCard } from './phone-setup-card';
import { SoundsCard } from './sounds-card';
import { composeMessage, DEFAULT_TEMPLATES } from '@/lib/parcel-logic';
import {
  columnError,
  gapError,
  SMS_GAP_LIMITS,
  templateError,
  type Settings,
} from '@/lib/settings-logic';
import { saveSettings, settingsAdmin, useSettings } from '@/lib/settings-service';
import { useT, type MessageKey } from '@/lib/i18n-react';
import type { Message } from '@/lib/messages';

export function SettingsView() {
  const t = useT();
  const settings = useSettings();

  return (
    <>
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">{t('settings.title')}</h1>
      <p className="mt-1 text-muted-foreground">{t('settings.lead')}</p>

      {!settings ? (
        <div className="mt-6 flex flex-col gap-6" aria-busy="true" aria-label={t('settings.loading')}>
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <BackupCard />
          <FolderSettings />
          <ImportSection settings={settings} readOnly={!settingsAdmin()} />
          <TemplateSection settings={settings} readOnly={!settingsAdmin()} />
          <GapSection settings={settings} readOnly={!settingsAdmin()} />
          <GatewayCard />
          <SoundsCard />
          <PhoneSetupCard />
        </div>
      )}
    </>
  );
}

type Errors<T> = Partial<Record<keyof T, Message | null>>;

/** Local draft for one section: edits stay here until Save, so a half-typed path never takes effect. */
function useSection<K extends keyof Settings>(settings: Settings, keys: K[], validate: (d: Pick<Settings, K>) => Errors<Pick<Settings, K>>) {
  const t = useT();
  const pick = () => Object.fromEntries(keys.map((k) => [k, settings[k]])) as Pick<Settings, K>;
  const [draft, setDraft] = useState(pick);
  const [errors, setErrors] = useState<Errors<Pick<Settings, K>>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(pick());

  const set = <F extends K>(key: F, value: Settings[F]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: null }));
    setStatus('idle');
    setSaveError('');
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const found = validate(draft);
    setErrors(found);
    const first = Object.entries(found).find(([, v]) => v)?.[0];
    if (first) return document.getElementById(`field-${first}`)?.focus();
    setStatus('saving');
    setSaveError('');
    try {
      await saveSettings(draft);
      setStatus('saved');
    } catch (err) {
      setStatus('idle');
      setSaveError(t('common.notSaved', { error: (err as Error).message }));
    }
  }

  return { draft, set, errors, status, saveError, dirty, save, reset: () => (setDraft(pick()), setErrors({}), setSaveError('')) };
}

function SectionCard({
  id,
  title,
  description,
  badge,
  children,
  section,
  readOnly,
}: {
  id: string;
  title: string;
  description: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  section: Pick<ReturnType<typeof useSection>, 'save' | 'dirty' | 'status' | 'saveError' | 'reset'>;
  /** Staff see the shared settings; the server saves them for the admin only. */
  readOnly: boolean;
}) {
  const t = useT();
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
      <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-5 px-5 py-5 sm:px-6">
        {children}
      </fieldset>
      {readOnly ? (
        <p className="border-t px-5 py-3 text-sm text-muted-foreground sm:px-6">{t('settings.adminOnly')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 border-t px-5 py-3 sm:px-6">
          <Button type="submit" disabled={!section.dirty || section.status === 'saving'}>
            {section.status === 'saving' ? t('common.saving') : t('common.saveChanges')}
          </Button>
          {section.dirty && (
            <Button type="button" variant="ghost" onClick={section.reset}>
              {t('common.discard')}
            </Button>
          )}
          <p aria-live="polite" className="text-sm">
            {section.saveError ? (
              <span className="text-destructive">{section.saveError}</span>
            ) : section.status === 'saved' && !section.dirty ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <Check className="size-4" aria-hidden />
                {t('settings.savedForAll')}
              </span>
            ) : section.dirty ? (
              <span className="text-muted-foreground">{t('settings.unsaved')}</span>
            ) : null}
          </p>
        </div>
      )}
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
  error?: Message | null;
  children: React.ReactNode;
}) {
  const t = useT();
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
          {t(error.key, error.vars)}
        </p>
      )}
    </div>
  );
}

const described = (name: string, error?: Message | null, hint = true) =>
  [hint && `hint-${name}`, error && `error-${name}`].filter(Boolean).join(' ') || undefined;

const ALWAYS: MessageKey[] = ['settings.always1', 'settings.always2'];

function ImportSection({ settings, readOnly }: { settings: Settings; readOnly: boolean }) {
  const t = useT();
  const s = useSection(settings, ['trackingColumn', 'phoneColumn', 'duplicateFile'], (d) => ({
    trackingColumn: columnError(d.trackingColumn),
    phoneColumn: columnError(d.phoneColumn),
  }));
  return (
    <SectionCard id="import" title={t('settings.import.title')} description={t('settings.import.lead')} section={s} readOnly={readOnly}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="trackingColumn" label={t('settings.import.tracking')} hint={t('settings.import.trackingHint')} error={s.errors.trackingColumn}>
          <Input
            id="field-trackingColumn"
            value={s.draft.trackingColumn}
            onChange={(e) => s.set('trackingColumn', e.target.value)}
            aria-invalid={!!s.errors.trackingColumn}
            aria-describedby={described('trackingColumn', s.errors.trackingColumn)}
          />
        </Field>
        <Field name="phoneColumn" label={t('settings.import.phone')} hint={t('settings.import.phoneHint')} error={s.errors.phoneColumn}>
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
        <legend className="font-medium">{t('settings.import.again')}</legend>
        <p className="text-sm text-muted-foreground">{t('settings.import.againHint')}</p>
        <div className="mt-2 flex flex-col gap-1">
          {(
            [
              ['warn', 'settings.import.warn', 'settings.import.warnHelp'],
              ['block', 'settings.import.block', 'settings.import.blockHelp'],
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
                {t(label)}
                <span className="block text-sm text-muted-foreground">{t(help)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <p className="font-medium">{t('settings.import.always')}</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {ALWAYS.map((rule) => (
            <li key={rule}>{t(rule)}</li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}

const SAMPLE = { name: 'Sokha Chan', codes: ['CB4810276635', 'CB2291048871', 'CB7730192245'] };

function TemplateSection({ settings, readOnly }: { settings: Settings; readOnly: boolean }) {
  const t = useT();
  const s = useSection(settings, ['templates'], (d) => ({
    templates: templateError(d.templates.single) ?? templateError(d.templates.combined),
  }));
  const kinds = [
    ['single', 'settings.sms.single', SAMPLE.codes.slice(0, 1)],
    ['combined', 'settings.sms.combined', SAMPLE.codes],
  ] as const;
  const isDefault = JSON.stringify(s.draft.templates) === JSON.stringify(DEFAULT_TEMPLATES);

  return (
    <SectionCard
      id="templates"
      title={t('settings.sms.title')}
      description={t('settings.sms.lead')}
      section={s}
      readOnly={readOnly}
    >
      <p className="text-sm text-muted-foreground">
        {t.rich('settings.sms.placeholders', {
          name: <code className="font-mono text-foreground">{'{name}'}</code>,
          codes: <code className="font-mono text-foreground">{'{codes}'}</code>,
          count: <code className="font-mono text-foreground">{'{count}'}</code>,
        })}
      </p>
      {kinds.map(([kind, label, codes]) => {
        const text = s.draft.templates[kind];
        const error = templateError(text);
        const shown = s.errors.templates && error;
        const name = kind === 'single' ? 'templates' : 'templates-combined';
        return (
          <div key={kind} className="grid gap-3 lg:grid-cols-2">
            <Field name={name} label={t(label)} error={shown ? error : null}>
              <textarea
                id={`field-${name}`}
                value={text}
                onChange={(e) => s.set('templates', { ...s.draft.templates, [kind]: e.target.value })}
                rows={4}
                aria-invalid={!!shown}
                aria-describedby={shown ? `error-${name}` : undefined}
                className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-base disabled:opacity-60 sm:text-sm"
              />
            </Field>
            <div>
              <p className="font-medium text-muted-foreground">{t('settings.sms.preview')}</p>
              <p className="mt-1.5 rounded-md bg-secondary px-3 py-2 text-sm">
                {error ? <span className="text-muted-foreground">{t('settings.sms.fixFirst')}</span> : composeMessage(SAMPLE.name, [...codes], s.draft.templates)}
              </p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {error ? '' : t('settings.sms.characters', { count: composeMessage(SAMPLE.name, [...codes], s.draft.templates).length })}
              </p>
            </div>
          </div>
        );
      })}
      {!isDefault && !readOnly && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => s.set('templates', DEFAULT_TEMPLATES)}>
            <RotateCcw aria-hidden />
            {t('settings.sms.restore')}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}

function GapSection({ settings, readOnly }: { settings: Settings; readOnly: boolean }) {
  const t = useT();
  const s = useSection(settings, ['smsGap'], (d) => ({ smsGap: gapError(d.smsGap) }));
  const { from, to } = s.draft.smsGap;
  const setGap = (key: 'from' | 'to', value: string) => s.set('smsGap', { ...s.draft.smsGap, [key]: value === '' ? NaN : Number(value) });
  const number = (key: 'from' | 'to', id: string) => (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={SMS_GAP_LIMITS.min}
      max={SMS_GAP_LIMITS.max}
      value={Number.isNaN(s.draft.smsGap[key]) ? '' : s.draft.smsGap[key]}
      onChange={(e) => setGap(key, e.target.value)}
      aria-invalid={!!s.errors.smsGap}
      aria-describedby={described('smsGap', s.errors.smsGap)}
      className="w-full"
    />
  );
  return (
    <SectionCard
      id="sms-gap"
      title={t('settings.gap.title')}
      description={t('settings.gap.lead')}
      section={s}
      readOnly={readOnly}
    >
      <div className="flex flex-col gap-3">
        <div className="grid max-w-md grid-cols-1 items-start gap-4 sm:grid-cols-2">
          <Field name="smsGap" label={t('settings.gap.from')} hint={t('settings.gap.fromHint', { min: SMS_GAP_LIMITS.min })} error={s.errors.smsGap}>
            {number('from', 'field-smsGap')}
          </Field>
          <Field name="smsGap-to" label={t('settings.gap.to')} hint={t('settings.gap.toHint', { max: SMS_GAP_LIMITS.max })}>
            {number('to', 'field-smsGap-to')}
          </Field>
        </div>
        {!gapError(s.draft.smsGap) && (
          <p className="max-w-xl text-sm text-muted-foreground">
            {t('settings.gap.estimate', { from: Math.max(1, Math.round((49 * from) / 60)), to: Math.ceil((49 * to) / 60) })}
          </p>
        )}
      </div>
    </SectionCard>
  );
}
