import { CircleCheck, CircleX, FlaskConical, PauseCircle, Radio, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ImportStatus } from '@/lib/import-logic';
import type { MonitorStatus } from '@/lib/mock/import-service';

type State = ImportStatus | MonitorStatus;

// One label set for every state on the page: an icon and a word, never colour alone.
const STATES: Record<State, { label: string; icon: LucideIcon; variant: 'success' | 'warning' | 'destructive' | 'info' | 'neutral' }> = {
  imported: { label: 'Imported', icon: CircleCheck, variant: 'success' },
  failed: { label: 'Failed', icon: CircleX, variant: 'destructive' },
  active: { label: 'Active', icon: Radio, variant: 'success' },
  inactive: { label: 'Inactive', icon: PauseCircle, variant: 'neutral' },
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
