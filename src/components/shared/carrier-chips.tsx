import { Hand, Send } from 'lucide-react';
import { CARRIER_LABEL, carrierCounts, type Carrier, type SimInfo } from '@/lib/carriers';
import { cn } from '@/lib/utils';

// A coloured initial per carrier, not the carriers' own logos (their trademarks). Dark shades: white text stays readable.
const BADGE: Record<Carrier | 'unknown', [string, string]> = {
  cellcard: ['C', 'bg-orange-700'],
  smart: ['S', 'bg-green-700'],
  metfone: ['M', 'bg-red-700'],
  seatel: ['Se', 'bg-sky-700'],
  unknown: ['?', 'bg-zinc-500'],
};

/** One card per carrier: who, how many customers, and whether the gateway phone texts them or staff contact them by hand. */
export function CarrierChips({ items, sims, className }: { items: { phone: string }[]; sims: SimInfo[]; className?: string }) {
  const rows = carrierCounts(items, sims);
  if (!rows.length) return null;
  return (
    <ul aria-label="Customers by carrier" className={cn('grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2', className)}>
      {rows.map((r) => {
        const [initial, bg] = BADGE[r.carrier ?? 'unknown'];
        return (
          <li key={r.carrier ?? 'unknown'} className="flex flex-col gap-1.5 rounded-md border bg-card px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm">
              <span aria-hidden className={cn('grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white', bg)}>
                {initial}
              </span>
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
