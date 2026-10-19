'use client';

import { useState } from 'react';
import { ChevronRight, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  eligibleForMessage,
  formatPhone,
  groupByPhone,
  groupContactStatus,
  groupSmsStatus,
  phoneKey,
  type ContactEvent,
  type Parcel,
} from '@/lib/parcel-logic';
import { cn } from '@/lib/utils';
import { ContactBadge, SmsBadge } from './parcel-status';
import { batchLabel, GroupList } from './phone-group';

const newestFirst = (a: Parcel, b: Parcel) => b.importedAt.localeCompare(a.importedAt);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The Parcels page's default view: one row per valid phone number per arrival batch, its parcels on expand.
 * `rows` are the parcels the filters let through; counts and the expanded list use the whole batch on that line,
 * never parcels from other arrival days.
 */
export function PhoneGroups({
  rows,
  batch,
  events,
  expandAll,
  onOpen,
}: {
  rows: Parcel[];
  /** The selected arrival dates: every parcel the date filter lets through. */
  batch: Parcel[];
  events: ContactEvent[];
  /** While searching, every matching group opens so the parcel searched for is in view. */
  expandAll: boolean;
  onOpen: (code: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [missingOpen, setMissingOpen] = useState(false);
  const toggle = (phone: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(phone)) next.add(phone);
      return next;
    });

  const groups = groupByPhone(rows)
    .filter((g) => g.phone) // missing or invalid numbers are never grouped: listed on their own below
    .map((g) => {
      const members = batch.filter((p) => phoneKey(p.phone) === g.phone && p.arrivalDate === g.day).sort(newestFirst);
      const eligible = eligibleForMessage(members, events);
      return { ...g, members, eligible, shown: g.codes.length };
    })
    // Lines with new parcels to notify come first; otherwise newest arrival first, as groupByPhone sorts.
    .sort((a, b) => Number(b.eligible.length > 0) - Number(a.eligible.length > 0));
  const noPhone = rows.filter((p) => phoneKey(p.phone) === null).sort(newestFirst);
  // Only name the day when the list spans several; on a single day it would repeat on every row.
  const manyDays = new Set(groups.map((g) => g.day)).size > 1;

  return (
    <div className="border-t">
      <ul>
        {groups.map((g) => {
          const id = `${g.day}|${g.phone}`;
          const expanded = expandAll || open.has(id);
          const day = batchLabel(g.day);
          const names = [...new Set(g.members.map((p) => p.recipient))];
          const sms = groupSmsStatus(g.members.map((p) => p.code), events);
          const contact = groupContactStatus(g.members.map((p) => p.code), events);
          const panel = `group-${g.day}-${g.phone}`;
          return (
            <li key={id} className="relative border-b last:border-b-0">
              {/* A thin periwinkle bar marks lines with new parcels nobody has told the customer about. */}
              {g.eligible.length > 0 && <span aria-hidden className="absolute inset-y-3 left-0 w-0.75 rounded-r-full bg-primary" />}
              {/* Phones: number and action on one line, counts below. Wide screens: every count in its own aligned column. */}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:px-5 xl:grid-cols-[minmax(0,1fr)_7rem_8rem_9.5rem_11rem_12rem]">
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  aria-expanded={expanded}
                  aria-controls={panel}
                  disabled={expandAll}
                  className="flex min-h-11 min-w-0 items-center gap-3 text-left disabled:cursor-default"
                >
                  <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} aria-hidden />
                  <span className="min-w-0">
                    <span className="block font-mono text-[15px] font-semibold">
                      {formatPhone(g.phone)}
                      {manyDays && <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">arrived {day}</span>}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground" title={names.join(', ')}>
                      {names.slice(0, 2).join(' · ')}
                      {names.length > 2 && ` · +${names.length - 2}`}
                    </span>
                  </span>
                </button>
                <span className="col-span-2 row-start-2 flex flex-wrap items-center gap-2 pl-7 text-sm xl:contents">
                  <span className="whitespace-nowrap text-muted-foreground">
                    {plural(g.members.length, 'parcel')}
                    {day === 'today' && ' today'}
                  </span>
                  <span>
                    {g.eligible.length > 0 && (
                      <span className="rounded-sm bg-accent px-2 py-0.5 text-xs font-medium whitespace-nowrap text-primary">
                        {g.eligible.length === g.members.length ? 'Ready to notify' : `${g.eligible.length} ready to notify`}
                      </span>
                    )}
                  </span>
                  {/* Each status shows only once it is past its starting point: "not sent" is what the to-notify count says. */}
                  <span>{sms !== 'not-sent' && <SmsBadge status={sms} />}</span>
                  <span>{contact !== 'needs-contact' && <ContactBadge status={contact} />}</span>
                </span>
                <span className="col-start-2 row-start-1 justify-self-end xl:col-start-auto xl:row-start-auto">
                  <Button size="sm" variant="outline" onClick={() => onOpen((g.eligible[0] ?? g.members[0]).code)}>
                    {g.eligible.length > 1 ? 'Prepare combined SMS' : g.eligible.length === 1 ? 'Prepare SMS' : 'Open'}
                  </Button>
                </span>
              </div>
              {expanded && (
                <div id={panel} className="px-4 pb-4 sm:pr-5 sm:pl-12">
                  <GroupList parcels={g.members} events={events} onSelect={onOpen} />
                  {g.shown < g.members.length && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {g.shown} of {g.members.length} match the current filters; the whole line is listed.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {noPhone.length > 0 && (
        <MissingPhones parcels={noPhone} open={missingOpen || expandAll || groups.length === 0} onToggle={() => setMissingOpen(!missingOpen)} onOpen={onOpen} />
      )}
    </div>
  );
}

/**
 * Parcels without a valid number: never grouped, left out of SMS until one is added.
 * Collapsed under the groups, since the groups are the day's main work; it opens by itself when it is all there is to show.
 */
function MissingPhones({ parcels, open, onToggle, onOpen }: { parcels: Parcel[]; open: boolean; onToggle: () => void; onOpen: (code: string) => void }) {
  return (
    <section aria-labelledby="missing-phones-heading" className="border-t">
      <h3 id="missing-phones-heading">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="missing-phones-list"
          className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-sm sm:px-5"
        >
          <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
          <PhoneOff className="size-4 shrink-0 text-warning" aria-hidden />
          <span className="font-medium">Missing phone numbers</span>
          <span className="rounded-full bg-warning-tint px-2 py-0.5 font-mono text-xs font-medium text-warning">{parcels.length}</span>
          <span className="hidden text-muted-foreground sm:inline">Left out of SMS until a number is added</span>
        </button>
      </h3>
      {open && (
        <ul id="missing-phones-list" className="divide-y px-4 pb-3 sm:pr-5 sm:pl-12">
          {parcels.map((p) => (
            <li key={p.code} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <span className="min-w-0 flex-1 basis-56 text-sm">
                <span className="font-mono font-medium">{p.code}</span>
                <span className="text-muted-foreground"> · {p.recipient}</span>
              </span>
              <Button size="sm" variant="outline" onClick={() => onOpen(p.code)}>
                Add phone
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
