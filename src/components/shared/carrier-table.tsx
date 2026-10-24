import { CARRIER_LABEL, carrierCounts, type SimInfo } from '@/lib/carriers';
import { cn } from '@/lib/utils';

/** Customers per carrier and how each group is told: by SMS from its SIM, or by hand (Phase 12). */
export function CarrierTable({ items, sims, className, compact }: { items: { phone: string }[]; sims: SimInfo[]; className?: string; compact?: boolean }) {
  const rows = carrierCounts(items, sims);
  if (!rows.length) return null;
  return (
    <table className={cn('w-full', compact ? 'text-xs' : 'text-sm', className)}>
      <caption className="sr-only">Customers by carrier</caption>
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th scope="col" className="py-1.5 font-medium">
            Carrier
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Customers
          </th>
          <th scope="col" className={cn('py-1.5 font-medium', compact ? 'pl-3' : 'pl-4')}>
            {compact ? 'How' : 'How they are told'}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.carrier ?? 'unknown'} className="border-b last:border-0">
            <th scope="row" className="py-1.5 text-left font-normal">
              {r.carrier ? CARRIER_LABEL[r.carrier] : 'Unknown prefix'}
            </th>
            <td className="py-1.5 text-right font-mono">{r.count}</td>
            <td className={cn('py-1.5', compact ? 'pl-3' : 'pl-4')}>
              {r.sim ? `SMS from SIM ${r.sim}` : <span className="text-warning">{compact ? 'By hand' : 'Contact by hand'}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
