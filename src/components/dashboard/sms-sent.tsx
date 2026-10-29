'use client';

import { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { CARRIER_DOT } from '@/components/shared/carrier-chips';
import { CARRIER_LABEL, type SimInfo } from '@/lib/carriers';
import { formatDate } from '@/lib/i18n';
import { useT } from '@/lib/i18n-react';
import { periods, plan, type DayTotal, type Period, type PeriodKind } from '@/lib/sms-usage';
import { cn } from '@/lib/utils';

// SIM slot colours in a fixed order, checked together for colour-blind separation (dataviz validator, 2026-10-29). The
// carriers' own colours (Smart green, Cellcard orange) are too close for protan vision, so the carrier shows as a dot.
// Slot 0 is the SMS sent before each one had a SIM (Phase 12). `ink` is the value written inside a segment: whichever
// of white or navy reads at 4.5:1 on that fill.
const SLOT: Record<number, { fill: string; ink: string }> = {
  1: { fill: '#4f5bd5', ink: '#ffffff' },
  2: { fill: '#eb6834', ink: '#1b2033' },
  0: { fill: '#1baf7a', ink: '#1b2033' },
};
const slotOf = (sim: number) => SLOT[sim] ?? { fill: '#8c867b', ink: '#ffffff' };
const COUNT: Record<PeriodKind, number> = { week: 8, month: 6 };
// A segment this share of the scale or wider has room for its number inside (about 3 digits on a phone's bar).
const ROOM = 0.16;

/**
 * The Dashboard's SMS sent (v0.2.1, owner 2026-10-29): SMS sent per week or month as horizontal stacked bars, one row
 * per period, a forecast card beside it, and the detailed table below. One list of periods feeds all three.
 */
export function SmsSent({ sims }: { sims: SimInfo[] | null }) {
  const t = useT();
  const [usage, setUsage] = useState<{ today: string; days: DayTotal[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<PeriodKind>('week');
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/sms/usage', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setUsage, (e: Error) => setError(e.message));
  }, []);

  const list = usage ? periods(usage.days, kind, usage.today, COUNT[kind]) : [];
  const next = plan(list, usage?.days[0]?.day); // the days come oldest first; weeks and months follow the same rules
  const slots = [...new Set(usage?.days.map((d) => d.sim) ?? [])].sort((a, b) => (a || 9) - (b || 9));
  const simName = (sim: number) => (sim ? t('dash.sms.sim', { sim }) : t('dash.sms.noSim'));
  const carrierOf = (sim: number) => sims?.find((s) => s.simNumber === sim)?.carrier ?? null;
  const day = (d: string, o: Intl.DateTimeFormatOptions) => formatDate(new Date(`${d}T12:00:00Z`), t.locale, o);
  const short = (p: Period) => (kind === 'month' ? day(p.start, { month: 'short' }) : day(p.start, { day: 'numeric', month: 'short' }));
  const long = (p: Period) =>
    kind === 'month' ? day(p.start, { month: 'long' }) : `${day(p.start, { day: 'numeric', month: 'short' })} – ${day(p.end, { day: 'numeric', month: 'short' })}`;
  const n = (v: number) => v.toLocaleString('en-US');
  const now = list.at(-1);
  const prev = list.at(-2);
  const week = kind === 'week';

  return (
    <section aria-labelledby="sms-sent-heading" className="mt-6 rounded-md border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 id="sms-sent-heading" className="text-base font-semibold">
            {t('dash.sms.title')}
          </h2>
          {now && prev && (
            <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <Stat label={t(week ? 'dash.sms.thisWeek' : 'dash.sms.thisMonth')}>
                <span className="font-mono font-medium">{n(now.total)}</span> {t('dash.sms.smsWord')}
              </Stat>
              <Stat label={t(week ? 'dash.sms.lastWeek' : 'dash.sms.lastMonth')}>
                <span className="font-mono">{n(prev.total)}</span> {t('dash.sms.smsWord')}
              </Stat>
              {next && (
                <Stat label={t('dash.sms.forecast')}>
                  <span className="font-mono">
                    {n(next.lo)}–{n(next.hi)}
                  </span>{' '}
                  {t(week ? 'dash.sms.smsNextWeek' : 'dash.sms.smsNextMonth')}
                </Stat>
              )}
            </dl>
          )}
        </div>
        <div role="radiogroup" aria-label={t('dash.sms.period')} className="inline-flex rounded-md border p-0.5 text-sm">
          {(['week', 'month'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={kind === v}
              onClick={() => {
                setKind(v);
                setHover(null);
              }}
              className={cn('min-h-9 rounded-[5px] px-3 font-medium transition-colors', kind === v ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {t(v === 'week' ? 'dash.sms.weeks' : 'dash.sms.months')}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="px-5 py-4 text-destructive">
          {t('dash.sms.failed', { error })}
        </p>
      ) : !usage ? (
        <div className="space-y-2 px-5 py-4" aria-busy="true" aria-label={t('common.loading')}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : usage.days.length === 0 ? (
        <p className="px-5 pt-1 pb-4 text-muted-foreground">{t('dash.sms.empty')}</p>
      ) : (
        <>
          <div className="grid gap-4 px-5 pt-3 pb-4 lg:grid-cols-[minmax(0,4fr)_minmax(12rem,1fr)] lg:items-start">
            <div className="min-w-0">
              <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={t('dash.sms.legend')}>
                {slots.map((sim) => {
                  const c = carrierOf(sim);
                  return (
                    <li key={sim} className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-[3px]" style={{ background: slotOf(sim).fill }} aria-hidden />
                      <span className="text-foreground">{simName(sim)}</span>
                      {c && (
                        <span className="flex items-center gap-1">
                          <span className="size-1.5 rounded-full" style={{ background: CARRIER_DOT[c] }} aria-hidden />
                          {CARRIER_LABEL[c]}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Bars list={list} slots={slots} hover={hover} onHover={setHover} label={short} long={long} simName={simName} />
            </div>
            <Forecast kind={kind} next={next} />
          </div>

          <div className="overflow-x-auto border-t">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-5 py-2 font-medium">{t(week ? 'dash.sms.weekCol' : 'dash.sms.monthCol')}</th>
                  {slots.map((sim) => (
                    <th key={sim} scope="col" className="px-3 py-2 text-right font-medium">{t('dash.sms.smsOf', { sim: simName(sim) })}</th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t('dash.sms.allSms')}</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">{t('dash.sms.failedCol')}</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {[...list].reverse().map((p, i) => {
                  const at = list.length - 1 - i;
                  return (
                    <tr
                      key={p.start}
                      onMouseEnter={() => setHover(at)}
                      onMouseLeave={() => setHover(null)}
                      className={cn('border-t transition-colors', hover === at ? 'bg-background' : p.partial && 'bg-accent/40')}
                    >
                      <th scope="row" className="px-5 py-2 text-left font-sans font-normal">
                        {long(p)}
                        {p.partial && <span className="ml-1.5 text-xs text-muted-foreground">{t('dash.sms.soFar')}</span>}
                      </th>
                      {slots.map((sim) => (
                        <td key={sim} className="px-3 py-2 text-right">{n(p.bySim[sim] ?? 0)}</td>
                      ))}
                      <td className="px-3 py-2 text-right font-medium">{n(p.total)}</td>
                      <td className={cn('px-5 py-2 text-right', p.failed ? 'text-foreground' : 'text-muted-foreground')}>{p.failed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">{t('dash.sms.note')}</p>
        </>
      )}
    </section>
  );
}

const Stat = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline gap-1.5">
    <dt className="text-muted-foreground">{label}:</dt>
    <dd>{children}</dd>
  </div>
);

/**
 * One row per period, newest at the bottom: the segments per SIM side by side, the total at the end. Plain HTML, so
 * the labels keep their size at any width and never overlap. The table below carries every number for screen readers.
 */
function Bars({
  list,
  slots,
  hover,
  onHover,
  label,
  long,
  simName,
}: {
  list: Period[];
  slots: number[];
  hover: number | null;
  onHover: (i: number | null) => void;
  label: (p: Period) => string;
  long: (p: Period) => string;
  simName: (sim: number) => string;
}) {
  const t = useT();
  const top = Math.max(...list.map((p) => p.total), 1);
  const step = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000].find((s) => top / s <= 4) ?? 25000;
  const scale = Math.ceil(top / step) * step; // one scale for every row, rounded up to a clean tick
  const ticks = Array.from({ length: scale / step + 1 }, (_, i) => i * step);
  const n = (v: number) => v.toLocaleString('en-US');
  const tick = (v: number) => (v >= 1000 ? `${Number((v / 1000).toFixed(1))}K` : String(v));
  const h = hover !== null ? list[hover] : null;
  const COLS = 'grid grid-cols-[4.25rem_minmax(0,1fr)_3.5rem] items-center gap-x-2';

  return (
    <div className="relative" aria-hidden onMouseLeave={() => onHover(null)}>
      <div className="relative">
        {/* The vertical grid, behind the bars and in line with the axis below. */}
        <div className={cn(COLS, 'pointer-events-none absolute inset-0')}>
          <span />
          <div className="relative h-full">
            {ticks.map((v) => (
              <span key={v} className="absolute inset-y-0 w-px bg-secondary" style={{ left: `${(v / scale) * 100}%` }} />
            ))}
          </div>
        </div>
        {list.map((p, i) => {
          const parts = slots.filter((s) => (p.bySim[s] ?? 0) > 0);
          return (
            <div
              key={p.start}
              className={cn(COLS, 'relative h-7 cursor-default transition-opacity', hover !== null && hover !== i && 'opacity-50')}
              onMouseEnter={() => onHover(i)}
              onClick={() => onHover(hover === i ? null : i)}
            >
              <span className={cn('truncate text-right font-mono text-xs', hover === i ? 'text-foreground' : 'text-muted-foreground')}>{label(p)}</span>
              <div className={cn('flex h-5 gap-0.5', p.partial && 'opacity-70')}>
                {parts.map((sim, k) => {
                  const v = p.bySim[sim]!;
                  return (
                    <div
                      key={sim}
                      className={cn('flex min-w-0 items-center justify-center overflow-hidden font-mono text-[11px] font-medium', k === parts.length - 1 && 'rounded-r-[4px]')}
                      style={{ width: `${(v / scale) * 100}%`, background: slotOf(sim).fill, color: slotOf(sim).ink }}
                    >
                      {v / scale >= ROOM && n(v)}
                    </div>
                  );
                })}
              </div>
              <span className="font-mono text-xs font-medium tabular-nums">{n(p.total)}</span>
            </div>
          );
        })}
      </div>
      <div className={cn(COLS, 'mt-1')}>
        <span />
        <div className="relative h-4">
          {ticks.map((v, i) => (
            <span
              key={v}
              className={cn('absolute top-0 font-mono text-[11px] text-muted-foreground', i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2')}
              style={{ left: `${(v / scale) * 100}%` }}
            >
              {tick(v)}
            </span>
          ))}
        </div>
      </div>

      {h && (
        <div
          className="pointer-events-none absolute right-0 z-10 min-w-44 rounded-md border bg-card px-3 py-2 text-xs shadow-[0_8px_24px_-8px_rgb(27_32_51/0.25)]"
          style={hover! < list.length / 2 ? { top: `${(hover! + 1) * 1.75 + 0.25}rem` } : { bottom: `${(list.length - hover!) * 1.75 + 1.25}rem` }}
        >
          <p className="font-medium">
            {long(h)}
            {h.partial && <span className="ml-1 font-normal text-muted-foreground">{t('dash.sms.soFar')}</span>}
          </p>
          {slots.map((sim) => (
            <p key={sim} className="mt-1 flex items-center gap-2">
              <span className="size-2 rounded-[2px]" style={{ background: slotOf(sim).fill }} />
              {simName(sim)}
              <span className="ml-auto pl-4 font-mono">{n(h.bySim[sim] ?? 0)}</span>
            </p>
          ))}
          <p className="mt-1 border-t pt-1 text-muted-foreground">{t('dash.sms.tip', { sms: n(h.total), failed: h.failed })}</p>
        </div>
      )}
    </div>
  );
}

/** The forecast, kept apart from the results: a range, since parcels are not steady. */
function Forecast({ kind, next }: { kind: PeriodKind; next: ReturnType<typeof plan> }) {
  const t = useT();
  const week = kind === 'week';
  return (
    <aside aria-label={t(week ? 'dash.sms.forecastWeek' : 'dash.sms.forecastMonth')} className="rounded-md border border-dashed bg-background/60 px-4 py-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
        {t(week ? 'dash.sms.forecastWeek' : 'dash.sms.forecastMonth')}
      </p>
      {next ? (
        <>
          <p className="mt-1 text-xl font-semibold tracking-tight">
            <span className="font-mono">
              {next.lo.toLocaleString('en-US')}–{next.hi.toLocaleString('en-US')}
            </span>{' '}
            <span className="text-sm font-normal text-muted-foreground">{t('dash.sms.smsWord')}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t(week ? 'dash.sms.forecastNoteWeek' : 'dash.sms.forecastNoteMonth', { count: next.from })}</p>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">{t(week ? 'dash.sms.forecastNoneWeek' : 'dash.sms.forecastNoneMonth')}</p>
      )}
    </aside>
  );
}
