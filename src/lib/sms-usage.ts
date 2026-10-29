// The Dashboard's SMS sent (v0.2.1, owner 2026-10-29): the daily SMS totals grouped into weeks (Monday to Sunday) or
// calendar months, with a range to plan the next one by. It counts SMS, not parts (owner, 2026-10-29); the parts the
// carrier counts are still saved with each day.

// The GSM-7 alphabet a plain SMS uses; the extension characters take two places. Anything else (Khmer, emoji) makes
// the whole SMS UCS-2, which fits far fewer characters.
const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = '^{}\\[~]|€';

/** How many SMS parts the carrier counts for this text: 160 / 153 per part in GSM-7, 70 / 67 in UCS-2. */
export function smsParts(text: string): number {
  let septets = 0;
  for (const ch of text) {
    if (GSM.includes(ch)) septets += 1;
    else if (GSM_EXT.includes(ch)) septets += 2;
    else return text.length <= 70 ? 1 : Math.ceil(text.length / 67); // UTF-16 units, as the phone counts UCS-2
  }
  return septets <= 160 ? 1 : Math.ceil(septets / 153);
}

export interface DayTotal {
  day: string; // YYYY-MM-DD, Cambodia time
  sim: number; // the gateway SIM slot; 0 before Phase 12
  sms: number;
  parts: number;
  failed: number;
}

export interface Period {
  start: string;
  end: string; // last day, inclusive
  partial: boolean; // contains today
  bySim: Record<number, number>; // SMS sent, by SIM
  total: number; // SMS sent, all SIMs
  failed: number;
}
export type PeriodKind = 'week' | 'month';

const DAY_MS = 86_400_000;
const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (d: Date) => d.toISOString().slice(0, 10);

function periodOf(day: string, kind: PeriodKind) {
  const d = toDate(day);
  if (kind === 'month') {
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { start: toDay(start), end: toDay(end) };
  }
  const start = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS); // back to Monday
  return { start: toDay(start), end: toDay(new Date(start.getTime() + 6 * DAY_MS)) };
}

/** The last `count` periods up to the one holding `today`, oldest first; periods with no SMS show as zero. */
export function periods(rows: DayTotal[], kind: PeriodKind, today: string, count: number): Period[] {
  const out: Period[] = [];
  let { start, end } = periodOf(today, kind);
  for (let i = 0; i < count; i++) {
    out.unshift({ start, end, partial: i === 0, bySim: {}, total: 0, failed: 0 });
    ({ start, end } = periodOf(toDay(new Date(toDate(start).getTime() - DAY_MS)), kind));
  }
  for (const r of rows) {
    const p = out.find((x) => r.day >= x.start && r.day <= x.end);
    if (!p) continue;
    p.bySim[r.sim] = (p.bySim[r.sim] ?? 0) + r.sms;
    p.total += r.sms;
    p.failed += r.failed;
  }
  return out;
}

const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length / 2;
  return a.length % 2 ? a[Math.floor(m)] : (a[m - 1] + a[m]) / 2;
};
/** The p-th quantile (0 to 1), linear between the sorted values. */
const quantile = (xs: number[], p: number) => {
  const a = [...xs].sort((x, y) => x - y);
  const at = (a.length - 1) * p;
  const lo = Math.floor(at);
  return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (at - lo);
};

/**
 * What to plan the next period for, as a range (owner, 2026-10-29), from the last complete periods that had SMS. A
 * period that began before `firstDay`, the first day with any total, is only partly counted, so it is left out.
 * 1. The normal period: the median of the last 4, so one busy sale week does not pull it up.
 * 2. A trend only when it is clear: the median slope between every two of the last 6 (Theil-Sen), followed only
 *    when it is at least 2% of the normal period and 3 in 4 of those slopes agree; ordinary ups and downs stay flat.
 * 3. The range: half the spread between the 20th and 80th percentile of the last 8, never under ±4%.
 * Rounded to tens; null until there are two such periods. Checked against steady, spiking, growing and falling weeks
 * (sms-usage.test.ts).
 */
export function plan(list: Period[], firstDay = '') {
  const done = list.filter((p) => !p.partial && p.total > 0 && p.start >= firstDay).map((p) => p.total);
  if (done.length < 2) return null;
  const recent = done.slice(-4);
  let centre = median(recent);
  const trend = done.slice(-6);
  if (trend.length >= 4) {
    const slopes = trend.flatMap((a, i) => trend.slice(i + 1).map((b, j) => (b - a) / (j + 1)));
    const slope = median(slopes);
    const agree = slopes.filter((v) => Math.sign(v) === Math.sign(slope)).length / slopes.length;
    // The median of the last few sits (n + 1) / 2 periods before the next one.
    if (Math.abs(slope) >= 0.02 * centre && agree >= 0.75) centre += (slope * (recent.length + 1)) / 2;
  }
  const spread = done.slice(-8);
  const half = Math.max((quantile(spread, 0.8) - quantile(spread, 0.2)) / 2, 0.04 * centre);
  const round = (n: number) => Math.max(0, Math.round(n / 10) * 10);
  return { lo: round(centre - half), hi: round(centre + half), from: spread.length };
}
