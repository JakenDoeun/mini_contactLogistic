// Date filter shared by the Parcels, Notifications and Import history lists.
// Pure: no React, no I/O, so it runs under `node --test`. Days follow the office computer's local time.

export type DatePreset = 'any' | 'today' | 'yesterday' | '7d' | '30d' | 'custom';

export interface DateRange {
  preset: DatePreset;
  /** Custom range only, as `YYYY-MM-DD`. Either end may be empty for an open range. */
  from?: string;
  to?: string;
}

export const ANY_DATE: DateRange = { preset: 'any' };

export const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'any', label: 'Any date' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'custom', label: 'Custom range' },
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

/** Fits after a verb in result lines: "imported in the last 7 days", "sent between 10 Oct and 12 Oct". */
export function rangePhrase(range: DateRange) {
  const fmt = (s?: string) => parseDay(s)?.toLocaleDateString([], { day: 'numeric', month: 'short' });
  const [from, to] = [fmt(range.from), fmt(range.to)];
  switch (range.preset) {
    case 'today':
      return 'today';
    case 'yesterday':
      return 'yesterday';
    case '7d':
      return 'in the last 7 days';
    case '30d':
      return 'in the last 30 days';
    default:
      return from && to ? (from === to ? `on ${from}` : `between ${from} and ${to}`) : from ? `since ${from}` : to ? `until ${to}` : 'at any time';
  }
}
