import { Hand, Send } from 'lucide-react';
import { CARRIER_LABEL, carrierCounts, type Carrier, type SimInfo } from '@/lib/carriers';
import { cn } from '@/lib/utils';

// Each carrier's brand colour (from its website, 2026-10-23: Cellcard #ff7900, Smart #009639, Metfone #db1a21; Seatel's
// site did not answer, so a neutral blue) as the card's top bar, and the name in a darker shade of it on a light tint
// (5:1 contrast or more). No logos: they are the carriers' trademarks.
export const COLOUR: Record<Carrier | 'unknown', { bar: string; text: string; tint: string }> = {
  cellcard: { bar: '#ff7900', text: '#a84f00', tint: '#fff0e0' },
  smart: { bar: '#009639', text: '#006b29', tint: '#e3f4e9' },
  metfone: { bar: '#db1a21', text: '#b0151b', tint: '#fce8e9' },
  seatel: { bar: '#0284c7', text: '#075985', tint: '#e0f2fe' },
  unknown: { bar: '#a1a1aa', text: '#52525b', tint: '#f4f4f5' },
};

/** One card per carrier: who, how many customers, and whether the gateway phone texts them or staff contact them by hand. */
export function CarrierChips({ items, sims, className }: { items: { phone: string }[]; sims: SimInfo[]; className?: string }) {
  const rows = carrierCounts(items, sims);
  if (!rows.length) return null;
  return (
    <ul aria-label="Customers by carrier" className={cn('grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2', className)}>
      {rows.map((r) => {
        const c = COLOUR[r.carrier ?? 'unknown'];
        return (
          <li
            key={r.carrier ?? 'unknown'}
            className="flex flex-col items-start gap-1.5 rounded-md border border-t-4 bg-card px-3 py-2.5"
            style={{ borderTopColor: c.bar }}
          >
            <span className="rounded px-1.5 py-0.5 text-sm font-semibold" style={{ color: c.text, backgroundColor: c.tint }}>
              {r.carrier ? CARRIER_LABEL[r.carrier] : 'Unknown'}
              {!r.carrier && <span className="sr-only"> prefix</span>}
            </span>
            <span className="font-mono text-2xl leading-none font-medium">
              {r.count}
              <span className="sr-only"> {r.count === 1 ? 'customer' : 'customers'},</span>
            </span>
            <span className={cn('flex items-center gap-1 text-xs font-medium', r.sim ? 'text-success' : 'text-warning')}>
              {r.sim ? <Send className="size-3.5" aria-hidden /> : <Hand className="size-3.5" aria-hidden />}
              {r.sim ? `SMS · SIM ${r.sim}` : 'By hand'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
