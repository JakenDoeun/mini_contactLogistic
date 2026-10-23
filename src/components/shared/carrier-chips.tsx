import { Hand, Send } from 'lucide-react';
import { CARRIER_LABEL, carrierCounts, type Carrier, type SimInfo } from '@/lib/carriers';
import { cn } from '@/lib/utils';

// Each carrier's brand colour, from its website (2026-10-23); Seatel's site did not answer, so a neutral blue. Shown as
// a small dot only. No logos: they are the carriers' trademarks.
const DOT: Record<Carrier | 'unknown', string> = {
  cellcard: '#ff7900',
  smart: '#009639',
  metfone: '#db1a21',
  seatel: '#0284c7',
  unknown: '#a1a1aa',
};

/**
 * Customers per carrier as a uniform grid of compact cards: a dot and the carrier's name, the count, and whether the
 * gateway phone texts them or staff contact them by hand. A carrier with no customers has no card.
 */
export function CarrierChips({ items, sims, className }: { items: { phone: string }[]; sims: SimInfo[]; className?: string }) {
  const rows = carrierCounts(items, sims);
  if (!rows.length) return null;
  return (
    <ul aria-label="Customers by carrier" className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3', className)}>
      {rows.map((c) => (
        <li key={c.carrier ?? 'unknown'} className="flex h-full flex-col gap-1 rounded-md border bg-card px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: DOT[c.carrier ?? 'unknown'] }} />
            {c.carrier ? CARRIER_LABEL[c.carrier] : 'Unknown'}
            {!c.carrier && <span className="sr-only"> prefix</span>}
          </span>
          <span className="font-mono text-2xl leading-tight font-medium">
            {c.count}
            <span className="sr-only"> {c.count === 1 ? 'customer' : 'customers'},</span>
          </span>
          <span className={cn('mt-auto flex items-center gap-1 text-xs font-medium', c.sim ? 'text-success' : 'text-warning')}>
            {c.sim ? <Send className="size-3.5 shrink-0" aria-hidden /> : <Hand className="size-3.5 shrink-0" aria-hidden />}
            {c.sim ? `SMS · SIM ${c.sim}` : 'By hand'}
          </span>
        </li>
      ))}
    </ul>
  );
}
