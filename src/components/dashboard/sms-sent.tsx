'use client';

import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { CARRIER_DOT } from '@/components/shared/carrier-chips';
import { CARRIER_LABEL, type SimInfo } from '@/lib/carriers';
import { formatDate } from '@/lib/i18n';
import { useT } from '@/lib/i18n-react';
import { periods, plan, type DayTotal, type Period, type PeriodKind } from '@/lib/sms-usage';
import { cn } from '@/lib/utils';

// SIM slot colours in a fixed order, checked together for colour-blind separation (dataviz validator, 2026-10-29). The
// carriers' own colours (Smart green, Cellcard orange) are too close for protan vision, so the carrier shows as a dot.
// Slot 0 is the SMS sent before each one had a SIM (Phase 12).
const FILL: Record<number, string> = { 1: '#4f5bd5', 2: '#eb6834', 0: '#1baf7a' };
const fillOf = (sim: number) => FILL[sim] ?? '#8c867b';
const COUNT: Record<PeriodKind, number> = { week: 8, month: 6 };
const INK = { grid: '#ece8e1', axis: '#d8d2c7', muted: '#5e5950', text: '#1b2033', hatch: '#8c867b', hover: '#f5f3ef' };

/** The Dashboard's SMS sent (v0.2.1, owner 2026-10-29): parts sent per week or month, by SIM, with a table below. */
export function SmsSent({ sims }: { sims: SimInfo[] | null }) {
  const t = useT();
  const [usage, setUsage] = useState<{ today: string; days: DayTotal[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<PeriodKind>('week');
  const [hover, setHover] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/sms/usage', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setUsage, (e: Error) => setError(e.message));
  }, []);
  // Phones scroll the chart; it opens on the latest period. After layout, so the width is known.
  useEffect(() => {
    const el = scroller.current;
    if (el) requestAnimationFrame(() => (el.scrollLeft = el.scrollWidth));
  }, [usage, kind]);

  const list = usage ? periods(usage.days, kind, usage.today, COUNT[kind]) : [];
  const next = plan(list, kind);
  const slots = [...new Set(usage?.days.map((d) => d.sim) ?? [])].sort((a, b) => (a || 9) - (b || 9));
  const simName = (sim: number) => (sim ? t('dash.sms.sim', { sim }) : t('dash.sms.noSim'));
  const carrierOf = (sim: number) => sims?.find((s) => s.simNumber === sim)?.carrier ?? null;
  const label = (p: Period, long = false) =>
    kind === 'month'
      ? formatDate(new Date(`${p.start}T12:00:00Z`), t.locale, { month: long ? 'long' : 'short' })
      : long
        ? `${formatDate(new Date(`${p.start}T12:00:00Z`), t.locale, { day: 'numeric', month: 'short' })} – ${formatDate(new Date(`${p.end}T12:00:00Z`), t.locale, { day: 'numeric', month: 'short' })}`
        : formatDate(new Date(`${p.start}T12:00:00Z`), t.locale, { day: 'numeric', month: 'short' });
  const now = list.at(-1);
  const prev = list.at(-2);
  const n = (v: number) => v.toLocaleString('en-US');

  return (
    <section aria-labelledby="sms-sent-heading" className="mt-6 rounded-md border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 id="sms-sent-heading" className="text-base font-semibold">
            {t('dash.sms.title')}
          </h2>
          {now && prev && now.total + prev.total > 0 && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t.rich(kind === 'week' ? 'dash.sms.summaryWeek' : 'dash.sms.summaryMonth', {
                now: <span className="font-mono font-medium text-foreground">{n(now.total)}</span>,
                prev: <span className="font-mono">{n(prev.total)}</span>,
              }, { sms: n(now.sms) })}
              {next && <> {t.rich('dash.sms.plan', { range: <span className="font-medium text-foreground">{n(next.lo)}–{n(next.hi)}</span> }, { when: t(kind === 'week' ? 'dash.sms.nextWeek' : 'dash.sms.nextMonth') })}</>}
            </p>
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
        <p role="alert" className="px-5 py-5 text-destructive">
          {t('dash.sms.failed', { error })}
        </p>
      ) : !usage ? (
        <div className="space-y-3 px-5 py-5" aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : usage.days.length === 0 ? (
        <p className="px-5 pt-2 pb-5 text-muted-foreground">{t('dash.sms.empty')}</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 px-5 pt-4 text-sm">
            {slots.map((sim) => {
              const c = carrierOf(sim);
              return (
                <li key={sim} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-[3px]" style={{ background: fillOf(sim) }} aria-hidden />
                  {simName(sim)}
                  {c && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <span className="size-1.5 rounded-full" style={{ background: CARRIER_DOT[c] }} aria-hidden />
                      {CARRIER_LABEL[c]}
                    </span>
                  )}
                </li>
              );
            })}
            {next && (
              <li className="flex items-center gap-2 text-muted-foreground">
                <svg width="10" height="10" aria-hidden>
                  <rect width="10" height="10" rx="2" fill="url(#sms-plan-hatch)" stroke={INK.hatch} />
                </svg>
                {t(kind === 'week' ? 'dash.sms.planKeyWeek' : 'dash.sms.planKeyMonth', { count: next.from })}
              </li>
            )}
          </ul>

          <div ref={scroller} className="overflow-x-auto px-3 pt-2 pb-1 sm:px-5" onMouseLeave={() => setHover(null)}>
            <div className="min-w-[560px]">
              <Chart list={list} slots={slots} next={next} hover={hover} onHover={setHover} label={label} nextLabel={t(kind === 'week' ? 'dash.sms.nextWeekLabel' : 'dash.sms.nextMonthLabel')} simName={simName} />
            </div>
          </div>

          <div className="overflow-x-auto border-t">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-5 py-2.5 font-medium">{t(kind === 'week' ? 'dash.sms.weekCol' : 'dash.sms.monthCol')}</th>
                  {slots.map((sim) => (
                    <th key={sim} scope="col" className="px-3 py-2.5 text-right font-medium">{t('dash.sms.partsOf', { sim: simName(sim) })}</th>
                  ))}
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t('dash.sms.allParts')}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t('dash.sms.smsCol')}</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">{t('dash.sms.failedCol')}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {[...list].reverse().map((p, i) => (
                  <tr key={p.start} className={cn('border-t', hover === list.length - 1 - i && 'bg-background')} onMouseEnter={() => setHover(list.length - 1 - i)}>
                    <th scope="row" className="px-5 py-2.5 text-left font-sans font-normal">
                      {label(p, true)}
                      {p.partial && <span className="ml-1.5 text-xs text-muted-foreground">{t('dash.sms.soFar')}</span>}
                    </th>
                    {slots.map((sim) => (
                      <td key={sim} className="px-3 py-2.5 text-right">{n(p.parts[sim] ?? 0)}</td>
                    ))}
                    <td className="px-3 py-2.5 text-right font-medium">{n(p.total)}</td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground">{n(p.sms)}</td>
                    <td className={cn('px-5 py-2.5 text-right', p.failed ? 'text-foreground' : 'text-muted-foreground')}>{p.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="flex items-start gap-1.5 border-t px-5 py-3 text-xs text-muted-foreground">
            <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t('dash.sms.note')}
          </p>
        </>
      )}
    </section>
  );
}

/** Stacked columns per period, one segment per SIM, then the next period's plan as a hatched range. */
function Chart({
  list,
  slots,
  next,
  hover,
  onHover,
  label,
  nextLabel,
  simName,
}: {
  list: Period[];
  slots: number[];
  next: ReturnType<typeof plan>;
  hover: number | null;
  onHover: (i: number | null) => void;
  label: (p: Period) => string;
  nextLabel: string;
  simName: (sim: number) => string;
}) {
  const t = useT();
  const W = 720, H = 220, L = 44, B = 28, T = 16;
  const top = Math.max(next?.hi ?? 0, ...list.map((p) => p.total), 1) * 1.1;
  const step = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000].find((s) => top / s <= 5) ?? 25000;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const band = (W - L) / (list.length + 1);
  const bw = Math.min(24, band * 0.5);
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const x = (i: number) => L + band * i + (band - bw) / 2;
  const short = (v: number) => (v >= 1000 ? `${Number((v / 1000).toFixed(1))}K` : String(v));
  const h = hover !== null ? list[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={t('dash.sms.chartLabel')}>
        <defs>
          <pattern id="sms-plan-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke={INK.hatch} strokeWidth="1.25" />
          </pattern>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke={INK.grid} strokeWidth={1} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fill={INK.muted} className="font-mono text-[11px]">{short(v)}</text>
          </g>
        ))}
        {list.map((p, i) => {
          let base = 0;
          const on = hover === i;
          const parts = slots.filter((s) => (p.parts[s] ?? 0) > 0);
          return (
            <g key={p.start} opacity={hover !== null && !on ? 0.45 : p.partial ? 0.75 : 1}>
              {/* The whole band is the hover and tap target, wider than the column. */}
              <rect x={x(i) - (band - bw) / 2} y={T} width={band} height={H - T - B} fill={on ? INK.hover : 'transparent'} onMouseEnter={() => onHover(i)} onClick={() => onHover(on ? null : i)} />
              {parts.map((sim, k) => {
                const v = p.parts[sim]!;
                const y0 = y(base) - (k ? 2 : 0); // a 2px surface gap between segments
                const y1 = y(base + v);
                base += v;
                const last = k === parts.length - 1;
                const r = last ? Math.min(4, (y0 - y1) / 2) : 0; // rounded data-end on the top segment only
                return y0 - y1 > 0 ? (
                  <path key={sim} pointerEvents="none" fill={fillOf(sim)}
                    d={`M${x(i)} ${y0} V${y1 + r} Q${x(i)} ${y1} ${x(i) + r} ${y1} H${x(i) + bw - r} Q${x(i) + bw} ${y1} ${x(i) + bw} ${y1 + r} V${y0} Z`} />
                ) : null;
              })}
              <text x={x(i) + bw / 2} y={H - 9} textAnchor="middle" fill={on ? INK.text : INK.muted} className="font-mono text-[11px]">{label(p)}</text>
            </g>
          );
        })}
        {next && (
          <g>
            <rect x={x(list.length)} y={y(next.hi)} width={bw} height={Math.max(y(next.lo) - y(next.hi), 4)} rx={4} fill="url(#sms-plan-hatch)" stroke={INK.hatch} strokeWidth={1} />
            <text x={x(list.length) + bw / 2} y={y(next.hi) - 8} textAnchor="middle" fill={INK.text} className="font-mono text-[11px] font-medium">{short(next.lo)}–{short(next.hi)}</text>
          </g>
        )}
        <text x={x(list.length) + bw / 2} y={H - 9} textAnchor="middle" fill={INK.muted} className="text-[11px]">{nextLabel}</text>
        <line x1={L} x2={W} y1={y(0)} y2={y(0)} stroke={INK.axis} strokeWidth={1} />
      </svg>
      {h && (
        <div
          role="status"
          className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-md border bg-card px-3 py-2 text-xs shadow-[0_8px_24px_-8px_rgb(27_32_51/0.25)]"
          style={hover! < list.length / 2 ? { left: `${((x(hover!) + bw + 10) / W) * 100}%` } : { right: `${((W - x(hover!) + 10) / W) * 100}%` }}
        >
          <p className="font-medium">{label(h)}</p>
          {slots.map((sim) => (
            <p key={sim} className="mt-1 flex items-center gap-2">
              <span className="size-2 rounded-[2px]" style={{ background: fillOf(sim) }} aria-hidden />
              {simName(sim)}
              <span className="ml-auto pl-4 font-mono">{(h.parts[sim] ?? 0).toLocaleString('en-US')}</span>
            </p>
          ))}
          <p className="mt-1 border-t pt-1 text-muted-foreground">{t('dash.sms.tip', { sms: h.sms.toLocaleString('en-US'), failed: h.failed })}</p>
        </div>
      )}
    </div>
  );
}
