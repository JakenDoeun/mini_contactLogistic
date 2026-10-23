'use client';

import { Boxes } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { smsStatusOf, type ContactEvent, type Parcel } from '@/lib/parcel-logic';
import { cn, formatDateTime } from '@/lib/utils';
import { SmsBadge } from './parcel-status';
import { useT, type MessageKey } from '@/lib/i18n-react';

// One look for "these parcels share a phone number" on every page: info colour and the Boxes icon.
// Info, not warning: a group is not a problem, it only means one message can cover them all.

/** Days between an arrival day (YYYY-MM-DD) and today: 0 for today. */
export function daysAgo(day: string, now = new Date()) {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000);
}

/** An arrival batch said the way staff would: "today", "yesterday" or "10 Oct". */
export function batchLabel(day: string, t: (key: MessageKey) => string, now = new Date()) {
  const diff = daysAgo(day, now);
  const [y, m, d] = day.split('-').map(Number);
  return diff === 0 ? t('day.today') : diff === 1 ? t('day.yesterday') : new Date(y, m - 1, d).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

/** Shown only for groups of two or more. With `onClick` it opens the group. */
export function GroupBadge({ size, onClick, className }: { size: number; onClick?: () => void; className?: string }) {
  const t = useT();
  if (size < 2) return null;
  const badge = (
    <Badge variant="info" className={className}>
      <Boxes className="size-3.5" strokeWidth={2.25} aria-hidden />
      {t('parcel.groupLabel', { count: size })}
    </Badge>
  );
  return onClick ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded-sm hover:ring-1 hover:ring-info/50"
    >
      {badge}
      <span className="sr-only">{t('group.show')}</span>
    </button>
  ) : (
    badge
  );
}

/** "2 of 3 still need notification", the count a combined SMS would cover. */
export function toNotifyLine(toNotify: number, size: number, t: (key: MessageKey, vars?: Record<string, number>) => string) {
  if (toNotify === 0) return t('group.toNotify.none');
  if (toNotify === size) return size === 1 ? t('group.toNotify.one') : t('group.toNotify.all', { count: size });
  return t('group.toNotify.some', { toNotify, count: size });
}

/** Each parcel of a group on its own line, with its own SMS and contact status. Records are never merged. */
export function GroupList({
  parcels,
  events,
  current,
  onSelect,
  className,
}: {
  parcels: Parcel[];
  events: ContactEvent[];
  /** The parcel already on screen; marked rather than linked. */
  current?: string;
  onSelect?: (code: string) => void;
  className?: string;
}) {
  const t = useT();
  return (
    <ul className={cn('divide-y rounded-md border bg-card', className)}>
      {parcels.map((p) => (
        <li key={p.code} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
          <div className="min-w-0 flex-1 basis-40">
            {onSelect && p.code !== current ? (
              <button
                type="button"
                onClick={() => onSelect(p.code)}
                className="font-mono font-medium text-primary underline-offset-4 hover:underline"
                aria-label={t('group.openParcel', { code: p.code })}
              >
                {p.code}
              </button>
            ) : (
              <span className="font-mono font-medium">{p.code}</span>
            )}
            {p.code === current && <span className="ml-2 text-xs text-muted-foreground">{t('group.thisParcel')}</span>}
            <span className="block text-xs text-muted-foreground">
              {t('group.imported', { recipient: p.recipient, time: formatDateTime(p.importedAt) })}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <SmsBadge status={smsStatusOf(p.code, events)} />
          </div>
        </li>
      ))}
    </ul>
  );
}
