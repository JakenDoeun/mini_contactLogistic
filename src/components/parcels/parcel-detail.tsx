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
  smsScope,
  smsStatusOf,
  type ContactEvent,
  type Parcel,
} from '@/lib/parcel-logic';
import { updatePhone, type ParcelData } from '@/lib/parcel-service';
import { formatDateTime } from '@/lib/utils';
import { ContactPanel } from './contact-panel';
import { PhoneText, SmsBadge } from './parcel-status';
import { batchLabel, GroupList } from './phone-group';

/**
 * One parcel with its phone line, the same on Scan, Parcels and Notifications.
 * Contact comes first: who it is and how to tell them. Below it, the parcel's facts only.
 */
export function ParcelDetail({
  parcel,
  data,
  Title = 'h2',
  onSelect,
  label = 'Parcel',
}: {
  parcel: Parcel;
  data: ParcelData;
  Title?: React.ElementType;
  onSelect?: (code: string) => void;
  /** Small text before the code, e.g. "Scanned" to confirm what the camera read. */
  label?: string;
}) {
  const group = phoneGroup(parcel, data.parcels); // this arrival batch only
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
            {label} <span className="font-mono">{parcel.code}</span>
          </p>
          <Title id="contact-heading" tabIndex={-1} className="mt-0.5 text-xl font-semibold outline-none">
            {parcel.recipient}
          </Title>
          <PhoneField key={parcel.code} parcel={parcel} />
          {key && <p className="mt-2 font-medium">{contactLine(eligibleForMessage(group, data.events).length, group.length, batchLabel(parcel.arrivalDate))}</p>}
          <div className="mt-4">
            <ContactPanel parcel={parcel} group={group} events={data.events} />
          </div>
        </section>

        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="parcel-heading" className="rounded-md border bg-card px-4 py-4 sm:px-5">
            <h3 id="parcel-heading" className="font-semibold">
              Parcel
            </h3>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="flex flex-wrap gap-1.5">
                <SmsBadge status={smsStatusOf(parcel.code, data.events)} />
              </dd>
              <dt className="text-muted-foreground">Arrived</dt>
              <dd>{arrivedText(parcel.arrivalDate)}</dd>
              <dt className="text-muted-foreground">Imported</dt>
              <dd>
                {formatDateTime(parcel.importedAt)}
                <span className="block text-sm break-all text-muted-foreground">{parcel.sourceFile}</span>
              </dd>
            </dl>

            {related.length > 0 && (
              <div className="mt-5">
                <h4 className="flex items-center gap-2 text-sm font-medium">
                  <Boxes className="size-4 text-info" aria-hidden />
                  Same phone, {batchLabel(parcel.arrivalDate)}: {related.length} more
                </h4>
                <GroupList parcels={related} events={data.events} onSelect={onSelect} className="mt-2" />
              </div>
            )}
            {otherDays > 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                {otherDays} more {otherDays === 1 ? 'parcel' : 'parcels'} on this number from other arrival days, not part of this message.{' '}
                <Link href={`/parcels?q=${key}`} className="font-medium text-primary underline-offset-4 hover:underline">
                  Show all
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

/** "Today, Oct 19" or "Oct 12": the arrival batch, never the import time. */
function arrivedText(day: string) {
  const label = batchLabel(day);
  const date = new Date(`${day}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return label === date ? date : `${label[0].toUpperCase()}${label.slice(1)}, ${date}`;
}

function PhoneField({ parcel }: { parcel: Parcel }) {
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
              aria-label={`Edit phone number ${formatPhone(parcel.phone)}`}
            >
              <Pencil aria-hidden />
              Edit
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Plus aria-hidden />
              Add phone
            </Button>
          )}
        </span>
        <p aria-live="polite" className="text-sm text-success">
          {saved && 'Saved for this parcel only. Related parcels now follow the new number.'}
        </p>
      </>
    );
  }

  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!isValidPhone(value)) return setError('Enter a full phone number, for example 012 345 678.');
        setSaving(true);
        try {
          await updatePhone(parcel, value);
          setEditing(false);
          setSaved(true);
        } catch (err) {
          setError(`Not saved. ${(err as Error).message}`);
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="min-w-40 flex-1">
        <label htmlFor="phone-edit" className="sr-only">
          Phone number
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
        {saving ? 'Saving…' : 'Save'}
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
        Cancel
      </Button>
    </form>
  );
}

const CHANNEL = { sms: Send, call: Phone, telegram: MessageSquare, other: Smartphone };
const OUTCOME_LABEL = { answered: 'Reached customer', 'no-answer': 'No answer', messaged: 'Sent on Telegram' };
const CHANNEL_LABEL = { call: 'Call: ', telegram: 'Telegram: ', other: '' };

function History({ events }: { events: ContactEvent[] }) {
  return (
    <section aria-labelledby="history-heading" className="rounded-md border bg-card px-4 py-4 sm:px-5">
      <h3 id="history-heading" className="font-semibold">
        Contact history
      </h3>
      {events.length === 0 ? (
        <p className="mt-1 text-muted-foreground">No messages or calls yet.</p>
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
                        ? smsScope(e.parcelCodes.length)
                        : e.channel === 'other'
                          ? 'SMS from another phone'
                          : `${CHANNEL_LABEL[e.channel]}${OUTCOME_LABEL[e.outcome!]}`}
                    </span>
                    {e.smsStatus && <SmsBadge status={e.smsStatus} bare />}
                  </p>
                  {e.result && <p className="text-sm text-muted-foreground">{e.result}</p>}
                </div>
                <time dateTime={e.at} className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatDateTime(e.at)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
