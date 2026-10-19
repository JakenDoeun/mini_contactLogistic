'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Boxes, Flag, MessageSquare, Pencil, Phone, Plus, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  contactStatusOf,
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
import { updatePhone, type ParcelData } from '@/lib/mock/parcel-service';
import { formatDateTime } from '@/lib/utils';
import { ContactPanel } from './contact-panel';
import { ContactBadge, PhoneText, SmsBadge } from './parcel-status';
import { batchLabel, GroupBadge, GroupList, groupLabel, toNotifyLine } from './phone-group';

/** One parcel with its phone line: details, related parcels, contact and history. Shared by search and scan. */
export function ParcelDetail({
  parcel,
  data,
  Title = 'h2',
  onSelect,
  actions,
  label = 'Tracking code',
}: {
  parcel: Parcel;
  data: ParcelData;
  Title?: React.ElementType;
  onSelect?: (code: string) => void;
  actions?: React.ReactNode;
  /** Small text above the code, e.g. "Scanned parcel" to set it apart from its related parcels. */
  label?: string;
}) {
  const group = phoneGroup(parcel, data.parcels); // this arrival batch only
  const related = group.filter((p) => p.code !== parcel.code);
  // Other days' parcels on the same number stay out of this group and its SMS, but staff can still find them.
  const key = phoneKey(parcel.phone);
  const otherDays = key ? data.parcels.filter((p) => phoneKey(p.phone) === key && !group.includes(p)).length : 0;

  return (
    <div className="@container">
      <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @3xl:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-label="Parcel" className="rounded-md border bg-card px-4 py-4 sm:px-5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <Title className="font-mono text-xl font-semibold break-all">{parcel.code}</Title>
            <div className="mt-2 flex flex-wrap gap-2">
              <SmsBadge status={smsStatusOf(parcel.code, data.events)} />
              <ContactBadge status={contactStatusOf(parcel.code, data.events)} />
              <GroupBadge size={group.length} />
            </div>
            {actions && <div className="mt-4">{actions}</div>}
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">Recipient</dt>
              <dd>{parcel.recipient}</dd>
              <dt className="self-center text-muted-foreground">Phone</dt>
              <dd>
                <PhoneField key={parcel.code} parcel={parcel} />
              </dd>
              <dt className="text-muted-foreground">Imported</dt>
              <dd className="font-mono">{formatDateTime(parcel.importedAt)}</dd>
              <dt className="text-muted-foreground">From file</dt>
              <dd className="font-mono break-all">{parcel.sourceFile}</dd>
            </dl>
          </section>

          {related.length > 0 && <RelatedParcels parcel={parcel} group={group} related={related} events={data.events} onSelect={onSelect} />}
          {otherDays > 0 && (
            <p className="-mt-2 px-1 text-sm text-muted-foreground">
              {otherDays} more {otherDays === 1 ? 'parcel' : 'parcels'} on this number from other arrival days, not part of this message.{' '}
              <Link href={`/parcels?q=${key}`} className="font-medium text-primary underline-offset-4 hover:underline">
                Show all
              </Link>
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <ContactPanel parcel={parcel} group={group} events={data.events} />
          <History events={eventsFor(parcel.code, data.events)} />
        </div>
      </div>
    </div>
  );
}

function RelatedParcels({
  parcel,
  group,
  related,
  events,
  onSelect,
}: {
  parcel: Parcel;
  group: Parcel[];
  related: Parcel[];
  events: ContactEvent[];
  onSelect?: (code: string) => void;
}) {
  return (
    <section aria-labelledby="related-heading" className="rounded-md border border-info/25 bg-info-tint px-4 py-4 sm:px-5">
      <h3 id="related-heading" className="flex items-start gap-2 font-semibold text-info">
        <Boxes className="mt-0.5 size-4 shrink-0" aria-hidden />
        Also arrived {batchLabel(parcel.arrivalDate)} for {formatPhone(parcel.phone)}: {related.length} more parcel{related.length === 1 ? '' : 's'}
      </h3>
      <p className="mt-0.5 pl-6 text-sm">
        {groupLabel(group.length)}, matched by phone number, not name. {toNotifyLine(eligibleForMessage(group, events).length, group.length)}.
      </p>
      <GroupList parcels={related} events={events} onSelect={onSelect} className="mt-3 border-info/20" />
    </section>
  );
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

const CHANNEL = { sms: Send, call: Phone, telegram: MessageSquare, flag: Flag };
const OUTCOME_LABEL = { answered: 'Reached customer', 'no-answer': 'No answer', messaged: 'Sent on Telegram', 'follow-up': 'Marked for follow-up' };
const CHANNEL_LABEL = { call: 'Call: ', telegram: 'Telegram: ', flag: '' };

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
