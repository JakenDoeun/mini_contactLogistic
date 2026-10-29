// The Dashboard's SMS sent (v0.2.1, owner 2026-10-29): SMS parts as the carrier counts them, and the daily totals
// grouped into weeks (Monday to Sunday) or calendar months, with a range to plan the next one by.

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
  parts: Record<number, number>; // by SIM
  total: number; // parts, all SIMs
  sms: number;
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
    out.unshift({ start, end, partial: i === 0, parts: {}, total: 0, sms: 0, failed: 0 });
    ({ start, end } = periodOf(toDay(new Date(toDate(start).getTime() - DAY_MS)), kind));
  }
  for (const r of rows) {
    const p = out.find((x) => r.day >= x.start && r.day <= x.end);
    if (!p) continue;
    p.parts[r.sim] = (p.parts[r.sim] ?? 0) + r.parts;
    p.total += r.parts;
    p.sms += r.sms;
    p.failed += r.failed;
  }
  return out;
}

/**
 * What to plan the next period for: from the usual (the mean) to the busiest of the last complete periods that had
 * SMS (4 weeks or 3 months), rounded to tens. Parcels are not steady, so it is a range, not one number; null until
 * there are at least two such periods to go by. A period that began before `firstDay`, the first day with any total,
 * is only partly counted (the totals started then), so it is left out.
 */
export function plan(list: Period[], kind: PeriodKind, firstDay = '') {
  const done = list.filter((p) => !p.partial && p.total > 0 && p.start >= firstDay).slice(kind === 'week' ? -4 : -3);
  if (done.length < 2) return null;
  const round = (n: number) => Math.round(n / 10) * 10;
  const totals = done.map((p) => p.total);
  return { lo: round(totals.reduce((a, b) => a + b, 0) / totals.length), hi: round(Math.max(...totals)), from: done.length };
}
