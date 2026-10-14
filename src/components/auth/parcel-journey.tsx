'use client';

import { useEffect, useRef } from 'react';
import { createTimeline, svg, type Timeline } from 'animejs';

// Labels are larger below the lg breakpoint, where the diagram is drawn smaller, so they stay readable on phones.
// The product's workflow as one small diagram: a parcel is scanned in, travels to sorting, and the customer's phone
// is notified. The server renders the finished state (all three steps lit), which is also what reduced-motion users and
// no-JS visitors see; with motion allowed, a looping timeline replays the journey.
const C = {
  track: '#2b3b5e',
  station: '#1b2a49',
  stationEdge: '#33466d',
  active: '#9aa3f5', // periwinkle, the app's primary lifted for the navy panel
  notify: '#b9a6f8', // violet, used only for the notification
  label: '#aeb8cc',
  parcel: '#d8b088',
  tape: '#b48659',
};

const STEPS = [
  ['Scan', 'The parcel is scanned in at the branch.'],
  ['Sort', 'Grouped by arrival day and phone number.'],
  ['Notify', 'One SMS tells the customer it is ready.'],
] as const;

export function ParcelJourney() {
  const svgRef = useRef<SVGSVGElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const root = svgRef.current;
    if (!root) return;
    const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
    const stations = [...root.querySelectorAll<SVGGElement>('[data-station]')];
    const captions = [...(listRef.current?.querySelectorAll<HTMLLIElement>('li') ?? [])];
    const light = (station: number, caption: number) => {
      stations.forEach((s, i) => (s.dataset.active = String(i <= station)));
      captions.forEach((c, i) => (c.dataset.active = String(i === caption)));
    };
    const showFinished = () => {
      stations.forEach((s) => (s.dataset.active = 'true'));
      captions.forEach((c) => (c.dataset.active = 'true'));
    };

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let tl: Timeline | null = null;

    const start = () => {
      if (tl || reduce.matches) return;
      const parcel = $('#cb-parcel');
      const [route] = svg.createDrawable($('#cb-route'));
      const [signal] = svg.createDrawable($('#cb-signal'));
      const { translateX: entryX, translateY: entryY } = svg.createMotionPath($('#cb-entry'));
      const { translateX: routeX, translateY: routeY } = svg.createMotionPath($('#cb-route-guide'));
      const badge = $('#cb-badge');
      const chip = $('#cb-chip');
      tl = createTimeline({ loop: true, loopDelay: 700, defaults: { ease: 'inOutSine' } })
        .call(() => light(-1, -1), 0)
        .set(parcel, { opacity: 0 }, 0)
        .set([route, signal], { draw: '0 0', opacity: 1 }, 0)
        .set(badge, { scale: 0, opacity: 0 }, 0)
        .set(chip, { opacity: 0, translateY: 4 }, 0)
        // 1. The parcel arrives and is scanned.
        .add(parcel, { translateX: entryX, translateY: entryY, opacity: [0, 1], duration: 700, ease: 'outCubic' }, 0)
        .call(() => light(0, 0), 500)
        .add('#cb-beam', { opacity: [0, 1, 0], translateY: [0, 34], duration: 650 }, 700)
        // 2. It travels the route to sorting.
        .call(() => light(0, 1), 1450)
        .add(route, { draw: ['0 0', '0 1'], duration: 1100 }, 1450)
        .add(parcel, { translateX: routeX, translateY: routeY, duration: 1100 }, 1450)
        .call(() => light(1, 1), 2550)
        // 3. The customer's phone is notified.
        .call(() => light(1, 2), 2700)
        .add(signal, { draw: ['0 0', '0 1'], duration: 600 }, 2700)
        .call(() => light(2, 2), 3300)
        .add(badge, { scale: [0, 1], opacity: [0, 1], duration: 450, ease: 'outBack' }, 3300)
        .add(chip, { opacity: [0, 1], translateY: [4, 0], duration: 400, ease: 'outCubic' }, 3400)
        // Hold, then clear for the next parcel.
        .add([parcel, chip, badge, route, signal], { opacity: 0, duration: 450 }, 5700);
    };
    const stop = () => {
      tl?.revert();
      tl = null;
      // revert() leaves the attributes createDrawable added on the route paths; remove them so the route shows again.
      for (const id of ['#cb-route', '#cb-signal']) {
        for (const attr of ['pathLength', 'stroke-dasharray', 'stroke-dashoffset', 'draw', 'style']) $(id).removeAttribute(attr);
      }
      showFinished();
    };
    const onVisibility = () => (document.hidden ? tl?.pause() : tl?.resume());
    const onMotionPreference = () => (reduce.matches ? stop() : start());

    start();
    document.addEventListener('visibilitychange', onVisibility);
    reduce.addEventListener('change', onMotionPreference);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      reduce.removeEventListener('change', onMotionPreference);
      stop();
    };
  }, []);

  return (
    <figure className="w-full">
      <svg
        ref={svgRef}
        viewBox="0 0 420 220"
        width={420}
        height={220}
        className="block h-auto w-full"
        role="img"
        aria-labelledby="cb-journey-title"
      >
        <title id="cb-journey-title">A parcel is scanned, sorted, and the customer is notified by SMS</title>
        {/* Paths: tracks (always visible), the drawn progress on top, and invisible guides for the parcel's motion. */}
        <path d="M70 150 C130 150 142 82 210 82" fill="none" stroke={C.track} strokeWidth={3} strokeLinecap="round" />
        <path d="M238 82 C290 82 300 150 333 150" fill="none" stroke={C.track} strokeWidth={2} strokeDasharray="3 6" strokeLinecap="round" />
        <path id="cb-route" d="M70 150 C130 150 142 82 210 82" fill="none" stroke={C.active} strokeWidth={3} strokeLinecap="round" />
        <path id="cb-signal" d="M238 82 C290 82 300 150 333 150" fill="none" stroke={C.notify} strokeWidth={2} strokeLinecap="round" />
        <path id="cb-entry" d="M-24 150 L70 150" fill="none" stroke="none" />
        <path id="cb-route-guide" d="M70 150 C130 150 142 82 210 82" fill="none" stroke="none" />

        {/* 1. Scan */}
        <g data-station data-active="true" className="group">
          <rect x={44} y={124} width={52} height={52} rx={12} fill={C.station} stroke={C.stationEdge} strokeWidth={1.5}
            className="transition-[stroke] duration-300 group-data-[active=true]:stroke-[#9aa3f5]" />
          <path d="M54 140 v-6 h6 M80 134 h6 v6 M86 160 v6 h-6 M60 166 h-6 v-6" fill="none" stroke={C.label} strokeWidth={1.5} strokeLinecap="round" />
          <line id="cb-beam" x1={52} y1={133} x2={88} y2={133} stroke={C.active} strokeWidth={1.5} opacity={0} />
          <text x={70} y={198} textAnchor="middle" className="fill-[#aeb8cc] font-mono text-[13px] tracking-[0.1em] transition-[fill] lg:text-[10px] lg:tracking-[0.12em] group-data-[active=true]:fill-white">SCAN</text>
        </g>

        {/* 2. Sort */}
        <g data-station data-active="true" className="group">
          <rect x={184} y={56} width={52} height={52} rx={12} fill={C.station} stroke={C.stationEdge} strokeWidth={1.5}
            className="transition-[stroke] duration-300 group-data-[active=true]:stroke-[#9aa3f5]" />
          {[70, 82, 94].map((y) => (
            <g key={y}>
              <line x1={196} y1={y} x2={216} y2={y} stroke={C.label} strokeWidth={1.5} strokeLinecap="round" />
              <circle cx={222} cy={y} r={2} fill={C.label} />
            </g>
          ))}
          <text x={210} y={130} textAnchor="middle" className="fill-[#aeb8cc] font-mono text-[13px] tracking-[0.1em] transition-[fill] lg:text-[10px] lg:tracking-[0.12em] group-data-[active=true]:fill-white">SORT</text>
        </g>

        {/* 3. Notify */}
        <g data-station data-active="true" className="group">
          <rect x={333} y={122} width={34} height={56} rx={8} fill={C.station} stroke={C.stationEdge} strokeWidth={1.5}
            className="transition-[stroke] duration-300 group-data-[active=true]:stroke-[#b9a6f8]" />
          <line x1={341} y1={138} x2={359} y2={138} stroke={C.label} strokeWidth={1.5} strokeLinecap="round" />
          <line x1={341} y1={146} x2={354} y2={146} stroke={C.label} strokeWidth={1.5} strokeLinecap="round" />
          <circle id="cb-badge" cx={367} cy={123} r={6} fill={C.notify} stroke="#14213a" strokeWidth={2} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
          <g id="cb-chip">
            <rect x={300} y={92} width={66} height={20} rx={10} fill="none" stroke={C.notify} strokeWidth={1.25} />
            <text x={333} y={105.5} textAnchor="middle" className="fill-[#e4defd] font-mono text-[11px] lg:text-[9px] lg:tracking-[0.06em]">SMS ready</text>
          </g>
          <text x={350} y={198} textAnchor="middle" className="fill-[#aeb8cc] font-mono text-[13px] tracking-[0.1em] transition-[fill] lg:text-[10px] lg:tracking-[0.12em] group-data-[active=true]:fill-white">NOTIFY</text>
        </g>

        {/* The parcel, drawn around its own centre so the motion paths place it exactly. Finished state: at sorting. */}
        <g id="cb-parcel" transform="translate(210 82)">
          <rect x={-11} y={-9} width={22} height={18} rx={3} fill={C.parcel} />
          <rect x={-2} y={-9} width={4} height={18} fill={C.tape} />
        </g>
      </svg>

      <figcaption className="sr-only">How Campus Branch handles a parcel</figcaption>
      <ol ref={listRef} className="mt-6 hidden gap-3 lg:grid lg:grid-cols-3">
        {STEPS.map(([name, text], i) => (
          <li
            key={name}
            data-active="true"
            className="rounded-xl border border-white/8 px-3 py-3 text-sidebar-foreground transition-colors duration-300 data-[active=true]:border-white/20 data-[active=true]:text-white"
          >
            <span className="font-mono text-[11px] tracking-[0.12em] text-[#9aa3f5]">0{i + 1}</span>
            <span className="ml-2 text-sm font-medium">{name}</span>
            <p className="mt-1 text-[13px] leading-snug opacity-80">{text}</p>
          </li>
        ))}
      </ol>
    </figure>
  );
}
