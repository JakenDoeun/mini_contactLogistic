'use client';

import { Ban, CircleCheck, CircleMinus, CircleX, Clock, Hand, PauseCircle, Radio, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ImportListItem } from '@/lib/import-api';
import { useT, type MessageKey } from '@/lib/i18n-react';

type State = ImportListItem['status'] | 'active' | 'inactive' | 'manual' | 'error';

// One label set for every state on the page: an icon and a word, never colour alone.
const STATES: Record<State, { label: MessageKey; icon: LucideIcon; variant: 'success' | 'warning' | 'destructive' | 'info' | 'neutral' }> = {
  imported: { label: 'status.imported', icon: CircleCheck, variant: 'success' },
  failed: { label: 'status.failed', icon: CircleX, variant: 'destructive' },
  checked: { label: 'status.toReview', icon: Clock, variant: 'info' },
  cancelled: { label: 'status.discarded', icon: Ban, variant: 'neutral' },
  no_eligible_rows: { label: 'status.noShopee', icon: CircleMinus, variant: 'neutral' },
  active: { label: 'status.active', icon: Radio, variant: 'success' },
  inactive: { label: 'status.inactive', icon: PauseCircle, variant: 'neutral' },
  manual: { label: 'status.manual', icon: Hand, variant: 'neutral' },
  error: { label: 'status.error', icon: TriangleAlert, variant: 'destructive' },
};

export function StatusBadge({ status, className }: { status: State; className?: string }) {
  const t = useT();
  const { label, icon: Icon, variant } = STATES[status];
  return (
    <Badge variant={variant} className={className}>
      <Icon className="size-3.5" strokeWidth={2.25} aria-hidden />
      {t(label)}
    </Badge>
  );
}
