// Date filter shared by the Parcels, Notifications and Import history lists.
// Pure: no React, no I/O, so it runs under `node --test`. Days follow the office computer's local time.
import { formatDate, type Locale } from './i18n.ts';
import type { MessageKey } from '@/lib/messages';

export type DatePreset = 'any' | 'today' | 'yesterday' | '7d' | '30d' | 'custom';

export interface DateRange {
  preset: DatePreset;
  /** Custom range only, as `YYYY-MM-DD`. Either end may be empty for an open range. */
  from?: string;
  to?: string;
}

export const ANY_DATE: DateRange = { preset: 'any' };

export const DATE_PRESETS: { key: DatePreset; label: MessageKey }[] = [
  { key: 'any', label: 'range.preset.any' },
  { key: 'today', label: 'range.preset.today' },
  { key: 'yesterday', label: 'range.preset.yesterday' },
  { key: '7d', label: 'range.preset.last7' },
  { key: '30d', label: 'range.preset.last30' },
  { key: 'custom', label: 'range.preset.custom' },
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const parseDay = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : null);

/** [start, end) in local time; null ends are open. */
function bounds(range: DateRange, now: Date): [Date | null, Date | null] {
  const today = startOfDay(now);
  switch (range.preset) {
    case 'any':
      return [null, null];
    case 'today':
      return [today, addDays(today, 1)];
    case 'yesterday':
      return [addDays(today, -1), today];
    case '7d':
      return [addDays(today, -6), addDays(today, 1)];
    case '30d':
      return [addDays(today, -29), addDays(today, 1)];
    case 'custom': {
      let [from, to] = [parseDay(range.from), parseDay(range.to)];
      if (from && to && from > to) [from, to] = [to, from]; // dates picked in the wrong order still mean that span
      return [from, to && addDays(to, 1)];
    }
  }
}

export function inDateRange(iso: string, range: DateRange, now = new Date()) {
  const [start, end] = bounds(range, now);
  const t = new Date(iso);
  return (!start || t >= start) && (!end || t < end);
}

export const isAnyDate = (range: DateRange) => range.preset === 'any' || (range.preset === 'custom' && !parseDay(range.from) && !parseDay(range.to));

/** Fills {range} in result lines: "imported in the last 7 days", "sent between 10 Oct and 12 Oct". */
export function rangePhrase(range: DateRange, t: ((key: MessageKey, vars?: Record<string, string>) => string) & { locale: Locale }) {
  const fmt = (s?: string) => { const d = parseDay(s); return d && formatDate(d, t.locale, { day: 'numeric', month: 'short' }); };
  const [from, to] = [fmt(range.from), fmt(range.to)];
  switch (range.preset) {
    case 'today':
      return t('range.today');
    case 'yesterday':
      return t('range.yesterday');
    case '7d':
      return t('range.last7');
    case '30d':
      return t('range.last30');
    default:
      return from && to
        ? from === to
          ? t('range.on', { date: from })
          : t('range.between', { from, to })
        : from
          ? t('range.since', { date: from })
          : to
            ? t('range.until', { date: to })
            : t('range.any');
  }
}
