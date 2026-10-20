import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  Clock,
  Loader,
  MessageSquare,
  PhoneOff,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatPhone, isValidPhone, type SmsStatus } from '@/lib/parcel-logic';

type Variant = 'success' | 'warning' | 'destructive' | 'neutral';

// "Sent" only means a gateway accepted it, so it stays neutral; green is kept for a delivery report.
const SMS: Record<SmsStatus, [string, LucideIcon, Variant]> = {
  'not-sent': ['Not sent', CircleDashed, 'neutral'],
  queued: ['Queued', Clock, 'neutral'],
  sending: ['Sending', Loader, 'neutral'],
  sent: ['Sent', MessageSquare, 'neutral'],
  delivered: ['Delivered', CircleCheck, 'success'],
  failed: ['Failed', CircleX, 'destructive'],
  unconfirmed: ['Unconfirmed', CircleHelp, 'warning'],
};

function StatusPill({ system, entry, bare }: { system: string; entry: [string, LucideIcon, Variant]; bare?: boolean }) {
  const [label, Icon, variant] = entry;
  return (
    <Badge variant={variant}>
      <Icon className="size-3.5" strokeWidth={2.25} aria-hidden />
      <span className={bare ? 'sr-only' : 'font-normal opacity-80'}>{system}</span>
      {label}
    </Badge>
  );
}

/** `bare` hides the system name visually, for table columns whose header already says it. */
export const SmsBadge = ({ status, bare }: { status: SmsStatus; bare?: boolean }) => (
  <StatusPill system={bare ? 'SMS: ' : 'SMS'} entry={SMS[status]} bare={bare} />
);

/** A parcel's phone as staff should read it: formatted, or plainly missing or invalid. */
export function PhoneText({ raw }: { raw: string }) {
  if (isValidPhone(raw)) return <span className="font-mono whitespace-nowrap">{formatPhone(raw)}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-warning">
      <PhoneOff className="size-3.5 shrink-0" aria-hidden />
      {raw.trim() ? (
        <span>
          <span className="font-mono">{raw}</span> · not a valid number
        </span>
      ) : (
        'No phone number'
      )}
    </span>
  );
}
