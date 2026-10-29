'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Boxes, MessageSquare, Pencil, Phone, Plus, Send, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  contactLine,
  eligibleForMessage,
  eventsFor,
  formatPhone,
  isValidPhone,
  phoneGroup,
  phoneKey,
  smsStatusOf,
  type ContactEvent,
  type Parcel,
} from '@/lib/parcel-logic';
import { updatePhone, type ParcelData } from '@/lib/parcel-service';
import { formatDateTime } from '@/lib/utils';
import { ContactPanel } from './contact-panel';
import { PhoneText, SmsBadge } from './parcel-status';
import { batchLabel, daysAgo, GroupList } from './phone-group';
import { formatDate, type Locale } from '@/lib/i18n';
import { useT, type MessageKey } from '@/lib/i18n-react';

/**
 * One parcel with its phone line, the same on Scan, Parcels and Notifications.
 * Contact comes first: who it is and how to tell them. Below it, the parcel's facts only.
 */
export function ParcelDetail({
  parcel,
  data,
  Title = 'h2',
  onSelect,
  label,
}: {
  parcel: Parcel;
  data: ParcelData;
  Title?: React.ElementType;
  onSelect?: (code: string) => void;
  /** Small text before the code, e.g. "Scanned" to confirm what the camera read. */
  label?: string;
}) {
  const t = useT();
  const group = phoneGroup(parcel, data.parcels); // this arrival batch only
  const line = phoneKey(parcel.phone) ? contactLine(eligibleForMessage(group, data.events).length, group.length, batchLabel(parcel.arrivalDate, t)) : null;
  const related = group.filter((p) => p.code !== parcel.code);
  // Other days' parcels on the same number stay out of this group and its SMS, but staff can still find them.
  const key = phoneKey(parcel.phone);
  const otherDays = key ? data.parcels.filter((p) => phoneKey(p.phone) === key && !group.includes(p)).length : 0;
  const history = eventsFor(parcel.code, data.events);

  return (
    <div className="@container">
      <div className="grid gap-5 @3xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] @3xl:items-start">
        <section aria-labelledby="contact-heading" className="rounded-md border bg-card px-4 py-4 sm:px-5">
          <p className="text-xs text-muted-foreground">
            {label ?? t('parcel.label')} <span className="font-mono">{parcel.code}</span>
          </p>
          <Title id="contact-heading" tabIndex={-1} className="mt-0.5 text-xl font-semibold outline-none">
            {parcel.recipient}
          </Title>
          <PhoneField key={parcel.code} parcel={parcel} />
          {line && <p className="mt-2 font-medium">{t(line.key, line.vars)}</p>}
          <div className="mt-4">
            <ContactPanel parcel={parcel} group={group} events={data.events} />
          </div>
        </section>

        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="parcel-heading" className="rounded-md border bg-card px-4 py-4 sm:px-5">
            <h3 id="parcel-heading" className="font-semibold">
              {t('parcel.heading')}
            </h3>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5">
              <dt className="text-muted-foreground">{t('parcel.status')}</dt>
              <dd className="flex flex-wrap gap-1.5">
                <SmsBadge status={smsStatusOf(parcel.code, data.events)} />
              </dd>
              <dt className="text-muted-foreground">{t('parcel.arrived')}</dt>
              <dd>{arrivedText(parcel.arrivalDate, t)}</dd>
              <dt className="text-muted-foreground">{t('parcel.imported')}</dt>
              <dd>
                {formatDateTime(parcel.importedAt, t.locale)}
                <span className="block text-sm break-all text-muted-foreground">{parcel.sourceFile}</span>
              </dd>
            </dl>

            {related.length > 0 && (
              <div className="mt-5">
                <h4 className="flex items-center gap-2 text-sm font-medium">
                  <Boxes className="size-4 text-info" aria-hidden />
                  {t('parcel.sameDay', { day: batchLabel(parcel.arrivalDate, t), count: related.length })}
                </h4>
                <GroupList parcels={related} events={data.events} onSelect={onSelect} className="mt-2" />
              </div>
            )}
            {otherDays > 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('parcel.otherDays', { count: otherDays })}{' '}
                <Link href={`/parcels?q=${key}`} className="font-medium text-primary underline-offset-4 hover:underline">
                  {t('parcel.showAll')}
                </Link>
              </p>
            )}
          </section>

          {history.length > 0 && <History events={history} />}
        </div>
      </div>
    </div>
  );
}

/** "Today, 19 Oct" or "12 Oct": the arrival batch, never the import time. */
function arrivedText(day: string, t: ((key: MessageKey, vars?: Record<string, string>) => string) & { locale: Locale }) {
  const date = formatDate(new Date(`${day}T00:00:00`), t.locale, { month: 'short', day: 'numeric' });
  if (daysAgo(day) !== 0 && daysAgo(day) !== 1) return date;
  const label = batchLabel(day, t);
  return t('parcel.arrivedOn', { day: `${label[0].toUpperCase()}${label.slice(1)}`, date });
}

function PhoneField({ parcel }: { parcel: Parcel }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(parcel.phone);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <>
        <span className="flex flex-wrap items-center gap-2">
          <PhoneText raw={parcel.phone} />
          {isValidPhone(parcel.phone) ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSaved(false);
                setEditing(true);
              }}
              aria-label={t('parcel.editPhone', { phone: formatPhone(parcel.phone) })}
            >
              <Pencil aria-hidden />
              {t('common.edit')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Plus aria-hidden />
              {t('groups.addPhone')}
            </Button>
          )}
        </span>
        <p aria-live="polite" className="text-sm text-success">
          {saved && t('parcel.phoneSaved')}
        </p>
      </>
    );
  }

  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!isValidPhone(value)) return setError(t('parcel.phoneInvalid'));
        setSaving(true);
        try {
          await updatePhone(parcel, value);
          setEditing(false);
          setSaved(true);
        } catch (err) {
          setError(t('common.notSaved', { error: (err as Error).message }));
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="min-w-40 flex-1">
        <label htmlFor="phone-edit" className="sr-only">
          {t('parcel.phoneNumber')}
        </label>
        <Input
          id="phone-edit"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          inputMode="tel"
          autoFocus
          aria-invalid={!!error}
          aria-describedby={error ? 'phone-error' : undefined}
          className="font-mono"
        />
        {error && (
          <p id="phone-error" className="mt-1 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" size="sm" disabled={saving}>
        {saving ? t('common.saving') : t('common.save')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setValue(parcel.phone);
          setSaved(false);
          setError('');
          setEditing(false);
        }}
      >
        {t('common.cancel')}
      </Button>
    </form>
  );
}

const CHANNEL = { sms: Send, call: Phone, telegram: MessageSquare, other: Smartphone };
const OUTCOME_LABEL: Record<string, MessageKey> = { answered: 'event.outcome.answered', 'no-answer': 'event.outcome.noAnswer', messaged: 'event.outcome.messaged' };
const CHANNEL_LABEL: Record<'call' | 'telegram', MessageKey> = { call: 'event.channel.call', telegram: 'event.channel.telegram' };

function History({ events }: { events: ContactEvent[] }) {
  const t = useT();
  return (
    <section aria-labelledby="history-heading" className="rounded-md border bg-card px-4 py-4 sm:px-5">
      <h3 id="history-heading" className="font-semibold">
        {t('parcel.contactHistory')}
      </h3>
      {events.length === 0 ? (
        <p className="mt-1 text-muted-foreground">{t('parcel.noContact')}</p>
      ) : (
        <ol className="mt-2 divide-y">
          {events.map((e) => {
            const Icon = CHANNEL[e.channel];
            return (
              <li key={e.id} className="flex gap-3 py-2.5">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">
                      {e.channel === 'sms'
                        ? t('sms.scope', { count: e.parcelCodes.length })
                        : e.channel === 'other'
                          ? t(e.outcome === 'answered' ? 'event.alreadyTold' : 'event.otherPhone')
                          : t(CHANNEL_LABEL[e.channel], { outcome: t(OUTCOME_LABEL[e.outcome!]) })}
                    </span>
                    {e.smsStatus && <SmsBadge status={e.smsStatus} bare />}
                  </p>
                  {e.result && <p className="text-sm text-muted-foreground">{e.result}</p>}
                </div>
                <time dateTime={e.at} className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatDateTime(e.at, t.locale)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
