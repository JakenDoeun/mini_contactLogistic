'use client';

import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n-react';
import { cn } from '@/lib/utils';

export type UpdateStep = 'download' | 'build' | 'wait' | 'switch';
type Status = { version: string; update: { state: 'updating'; step: UpdateStep; version: string } | { state: 'failed'; version: string; retry: boolean } | null };

// The login page's palette (parcel-journey.tsx), so the update reads as part of the same app.
const C = { track: '#2b3b5e', station: '#1b2a49', stationEdge: '#33466d', active: '#9aa3f5', label: '#aeb8cc', parcel: '#d8b088', tape: '#b48659' };
const LOG = 'C:\\ProgramData\\CampusBranch\\logs\\update.log';

/**
 * What the Windows updater (deploy/windows/update.ps1) is doing. While it gets and builds the next version the app keeps
 * working under a slim bar; while it switches, the app is down for a few seconds, so the page covers itself and reloads
 * once the new version answers, unless staff are typing or have a dialog open: then it asks them to reload.
 */
export function UpdateNotice({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [down, setDown] = useState(false);
  const [ready, setReady] = useState<string | null>(null);
  const loaded = useRef<string | null>(null);
  const updating = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch('/api/update', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as Status;
        loaded.current ??= body.version;
        if (body.version !== loaded.current) {
          // This page is the old version's. Reload now, unless that would lose what someone is typing.
          if (busy()) setReady(body.version);
          else return window.location.reload();
        }
        updating.current = body.update?.state === 'updating';
        setStatus(body);
        setDown(false);
      } catch {
        if (updating.current) setDown(true);
      }
      if (!stopped) timer = setTimeout(check, updating.current ? 3_000 : 60_000);
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  const u = status?.update;
  if (ready) return <ReadyBar version={ready} />;
  if (u?.state === 'updating' && (down || u.step === 'switch')) return <SwitchScene from={status!.version} to={u.version} />;
  if (u?.state === 'updating') return <UpdateBar step={u.step} version={u.version} />;
  if (u?.state === 'failed' && isAdmin) return <FailedBar version={u.version} current={status!.version} retry={u.retry} />;
  return null;
}

/** Someone is typing or has a dialog open, so a reload now would lose their work. */
const busy = () => !!document.querySelector('[role="dialog"]') || !!document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');

/** A small truck carrying a parcel, drawn facing right around (0, 0) = its rear wheel's road contact. */
function Truck({ wheels = true }: { wheels?: boolean }) {
  return (
    <g>
      <rect x={-8} y={-26} width={34} height={20} rx={3} fill={C.station} stroke={C.active} strokeWidth={1.5} />
      <rect x={3} y={-21} width={12} height={10} rx={1.5} fill={C.parcel} />
      <rect x={8} y={-21} width={2.5} height={10} fill={C.tape} />
      <path d="M28 -6 v-14 h7 l6 7 v7 z" fill={C.station} stroke={C.active} strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M31 -17 h3.5 l3.5 4 h-7 z" fill={C.active} opacity={0.55} />
      {wheels &&
        [2, 32].map((x) => (
          <g key={x} transform={`translate(${x} -4)`}>
            <g className="animate-[cb-spin_0.6s_linear_infinite] motion-reduce:animate-none" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
              <circle r={4.5} fill="#0f1a30" stroke={C.label} strokeWidth={1.25} />
              <line x1={-3} y1={0} x2={3} y2={0} stroke={C.label} strokeWidth={1} />
            </g>
          </g>
        ))}
    </g>
  );
}

const STEPS = ['download', 'build', 'switch'] as const;
const stepIndex = (s: UpdateStep) => (s === 'wait' ? 2 : STEPS.indexOf(s));

/** Get, Build, Switch: done ones ticked, the current one lit. */
function Steps({ step, dark }: { step: UpdateStep; dark?: boolean }) {
  const t = useT();
  const at = stepIndex(step);
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {STEPS.map((s, i) => (
        <li
          key={s}
          aria-current={i === at ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5 font-medium',
            i < at && (dark ? 'text-[#c9cff9]' : 'text-success'),
            i === at && (dark ? 'text-white' : 'text-primary'),
            i > at && (dark ? 'text-[#7f8aa6]' : 'text-muted-foreground'),
          )}
        >
          <span
            className={cn(
              'flex size-4 items-center justify-center rounded-full border text-[10px]',
              i < at && (dark ? 'border-[#9aa3f5] bg-[#9aa3f5] text-[#14213a]' : 'border-success bg-success text-white'),
              i === at && (dark ? 'border-[#9aa3f5]' : 'border-primary'),
            )}
          >
            {i < at ? <Check className="size-3" aria-hidden /> : i + 1}
          </span>
          {t(`update.steps.${s}`)}
        </li>
      ))}
    </ol>
  );
}

/** While the next version is fetched and built beside this one: a truck on a moving road, and what step it is on. */
export function UpdateBar({ step, version }: { step: UpdateStep; version: string }) {
  const t = useT();
  return (
    <section role="status" aria-live="polite" className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 overflow-hidden rounded-lg bg-sidebar px-4 py-3 text-white">
      <svg viewBox="0 0 120 34" width={120} height={34} aria-hidden className="shrink-0">
        <line x1={0} y1={31} x2={120} y2={31} stroke={C.track} strokeWidth={2} />
        <line x1={0} y1={31} x2={120} y2={31} stroke={C.label} strokeWidth={2} strokeDasharray="6 10" className="animate-[cb-road_0.8s_linear_infinite] motion-reduce:animate-none" />
        <g transform="translate(38 31)">
          <g className="animate-[cb-bob_0.4s_ease-in-out_infinite_alternate] motion-reduce:animate-none">
            <Truck />
          </g>
        </g>
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t('update.title', { version })}</p>
        <p className="text-[13px] text-sidebar-foreground">
          {t(`update.step.${step}`)} {step !== 'switch' && t('update.keepWorking')}
        </p>
      </div>
      <Steps step={step} dark />
    </section>
  );
}

/** The few seconds of the switch: the truck drives the parcel from the old version's depot to the new one. */
export function SwitchScene({ from, to }: { from: string; to: string }) {
  const t = useT();
  return (
    <div role="status" aria-live="assertive" className="fixed inset-0 z-50 flex items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-xl text-center text-white">
        <svg viewBox="0 0 420 200" width={420} height={200} className="mx-auto block h-auto w-full" role="img" aria-labelledby="cb-update-title">
          <title id="cb-update-title">{t('update.sceneTitle')}</title>
          <line x1={92} y1={140} x2={328} y2={140} stroke={C.track} strokeWidth={3} strokeLinecap="round" />
          <line x1={92} y1={140} x2={328} y2={140} stroke={C.active} strokeWidth={3} strokeLinecap="round" pathLength={1} strokeDasharray="1 1"
            className="animate-[cb-route_2.6s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:[stroke-dashoffset:0]" />
          {[
            { x: 40, label: `v${from}`, cls: '' },
            { x: 328, label: `v${to}`, cls: 'animate-[cb-arrive_2.6s_ease-in-out_infinite] motion-reduce:animate-none' },
          ].map((d) => (
            <g key={d.x}>
              <path d={`M${d.x} 140 v-44 l26 -16 l26 16 v44 z`} fill={C.station} stroke={C.stationEdge} strokeWidth={1.5} strokeLinejoin="round" className={d.cls} />
              <rect x={d.x + 16} y={114} width={20} height={26} rx={2} fill="#0f1a30" stroke={C.stationEdge} strokeWidth={1} />
              <text x={d.x + 26} y={166} textAnchor="middle" className="fill-[#aeb8cc] font-mono text-[13px]">{d.label}</text>
            </g>
          ))}
          <g transform="translate(96 140)">
            <g className="animate-[cb-drive_2.6s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:[transform:translateX(96px)]">
              <Truck />
            </g>
          </g>
        </svg>
        <p className="mt-4 text-lg font-semibold">{t('update.switchTitle', { version: to })}</p>
        <p className="mt-1 text-sm text-sidebar-foreground">{t('update.switchBody')}</p>
        <div className="mt-5 flex justify-center">
          <Steps step="switch" dark />
        </div>
      </div>
    </div>
  );
}

/** Admins only: the new version did not work, so the updater put the old one back. */
export function FailedBar({ version, current, retry }: { version: string; current: string; retry: boolean }) {
  const t = useT();
  return (
    <section role="status" className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-warning/30 bg-warning-wash px-4 py-3">
      {/* Back at the old version's depot, facing it. */}
      <svg viewBox="0 0 120 34" width={120} height={34} aria-hidden className="shrink-0 rounded-md bg-sidebar">
        <path d="M10 31 v-15 l11 -7 l11 7 v15 z" fill={C.station} stroke={C.active} strokeWidth={1.25} strokeLinejoin="round" />
        <rect x={17} y={21} width={8} height={10} rx={1} fill="#0f1a30" />
        <g transform="translate(84 31) scale(-1 1)">
          <Truck wheels={false} />
        </g>
      </svg>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-warning">{t('update.failedTitle', { version })}</p>
        <p className="text-muted-foreground">{t(retry ? 'update.failedRetryBody' : 'update.failedBody', { current, log: LOG })}</p>
      </div>
    </section>
  );
}

/** The new version is in, but this page is the old one and someone is typing: they reload when ready. */
export function ReadyBar({ version }: { version: string }) {
  const t = useT();
  return (
    <section role="status" className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-success-tint px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-success">{t('update.readyTitle', { version })}</p>
        <p className="text-muted-foreground">{t('update.readyBody')}</p>
      </div>
      <Button size="sm" onClick={() => window.location.reload()}>
        {t('update.reload')}
      </Button>
    </section>
  );
}
