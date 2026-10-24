'use client';

import { CARRIER_LABEL, carrierCounts, type SimInfo } from '@/lib/carriers';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n-react';

/** Customers per carrier and how each group is told: by SMS from its SIM, or by hand (Phase 12). */
export function CarrierTable({ items, sims, className, compact }: { items: { phone: string }[]; sims: SimInfo[]; className?: string; compact?: boolean }) {
  const t = useT();
  const rows = carrierCounts(items, sims);
  if (!rows.length) return null;
  return (
    <table className={cn('w-full', compact ? 'text-xs' : 'text-sm', className)}>
      <caption className="sr-only">{t('carrier.byCarrier')}</caption>
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th scope="col" className="py-1.5 font-medium">
            {t('carrier.column.carrier')}
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            {t('carrier.column.customers')}
          </th>
          <th scope="col" className={cn('py-1.5 font-medium', compact ? 'pl-3' : 'pl-4')}>
            {compact ? t('carrier.column.how') : t('carrier.column.howTold')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.carrier ?? 'unknown'} className="border-b last:border-0">
            <th scope="row" className="py-1.5 text-left font-normal">
              {r.carrier ? CARRIER_LABEL[r.carrier] : t('carrier.unknownPrefix')}
            </th>
            <td className="py-1.5 text-right font-mono">{r.count}</td>
            <td className={cn('py-1.5', compact ? 'pl-3' : 'pl-4')}>
              {r.sim ? t('carrier.smsFromSim', { sim: r.sim }) : <span className="text-warning">{compact ? t('carrier.byHand') : t('carrier.contactByHand')}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
