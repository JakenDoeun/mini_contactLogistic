'use client';

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
import { useT, type MessageKey } from '@/lib/i18n-react';

type Variant = 'success' | 'warning' | 'destructive' | 'neutral';

// "Sent" only means a gateway accepted it, so it stays neutral; green is kept for a delivery report.
const SMS: Record<SmsStatus, [MessageKey, LucideIcon, Variant]> = {
  'not-sent': ['smsStatus.notSent', CircleDashed, 'neutral'],
  queued: ['smsStatus.queued', Clock, 'neutral'],
  sending: ['smsStatus.sending', Loader, 'neutral'],
  sent: ['smsStatus.sent', MessageSquare, 'neutral'],
  delivered: ['smsStatus.delivered', CircleCheck, 'success'],
  failed: ['smsStatus.failed', CircleX, 'destructive'],
  unconfirmed: ['smsStatus.unconfirmed', CircleHelp, 'warning'],
};

function StatusPill({ system, entry, bare }: { system: string; entry: [MessageKey, LucideIcon, Variant]; bare?: boolean }) {
  const t = useT();
  const [label, Icon, variant] = entry;
  return (
    <Badge variant={variant}>
      <Icon className="size-3.5" strokeWidth={2.25} aria-hidden />
      <span className={bare ? 'sr-only' : 'font-normal opacity-80'}>{system}</span>
      {t(label)}
    </Badge>
  );
}

/** `bare` hides the system name visually, for table columns whose header already says it. */
export const SmsBadge = ({ status, bare }: { status: SmsStatus; bare?: boolean }) => (
  <StatusPill system={bare ? 'SMS: ' : 'SMS'} entry={SMS[status]} bare={bare} />
);

/** A parcel's phone as staff should read it: formatted, or plainly missing or invalid. */
export function PhoneText({ raw }: { raw: string }) {
  const t = useT();
  if (isValidPhone(raw)) return <span className="font-mono whitespace-nowrap">{formatPhone(raw)}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-warning">
      <PhoneOff className="size-3.5 shrink-0" aria-hidden />
      {raw.trim() ? (
        <span>{t.rich('phone.invalid', { number: <span className="font-mono">{raw}</span> })}</span>
      ) : (
        t('phone.none')
      )}
    </span>
  );
}
