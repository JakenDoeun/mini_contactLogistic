import { Ban, CircleCheck, CircleMinus, CircleX, Clock, FlaskConical, Hand, PauseCircle, Radio, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ImportListItem } from '@/lib/import-api';
import type { ImportStatus } from '@/lib/import-logic';
import type { MonitorStatus } from '@/lib/mock/import-service';

type State = ImportStatus | ImportListItem['status'] | MonitorStatus | 'manual';

// One label set for every state on the page: an icon and a word, never colour alone.
const STATES: Record<State, { label: string; icon: LucideIcon; variant: 'success' | 'warning' | 'destructive' | 'info' | 'neutral' }> = {
  imported: { label: 'Imported', icon: CircleCheck, variant: 'success' },
  failed: { label: 'Failed', icon: CircleX, variant: 'destructive' },
  checked: { label: 'To review', icon: Clock, variant: 'info' },
  cancelled: { label: 'Discarded', icon: Ban, variant: 'neutral' },
  no_eligible_rows: { label: 'No Shopee parcels', icon: CircleMinus, variant: 'neutral' },
  active: { label: 'Active', icon: Radio, variant: 'success' },
  inactive: { label: 'Inactive', icon: PauseCircle, variant: 'neutral' },
  manual: { label: 'Manual', icon: Hand, variant: 'neutral' },
  error: { label: 'Error', icon: TriangleAlert, variant: 'destructive' },
  preview: { label: 'Preview', icon: FlaskConical, variant: 'info' },
};

export function StatusBadge({ status, className }: { status: State; className?: string }) {
  const { label, icon: Icon, variant } = STATES[status];
  return (
    <Badge variant={variant} className={className}>
      <Icon className="size-3.5" strokeWidth={2.25} aria-hidden />
      {label}
    </Badge>
  );
}
