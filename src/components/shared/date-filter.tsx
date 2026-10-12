'use client';

import { useId } from 'react';
import { CalendarDays } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DATE_PRESETS, isAnyDate, type DatePreset, type DateRange } from '@/lib/date-range';
import { cn } from '@/lib/utils';

/** A date preset picker; "Custom range" adds From and To fields. `label` names what the dates are. `compact` matches sm:h-8 chips. */
export function DateFilter({
  value,
  onChange,
  label,
  compact,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  label: string;
  compact?: boolean;
}) {
  const id = useId();
  const height = compact ? 'sm:h-8' : 'sm:h-9';
  const active = !isAnyDate(value);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <CalendarDays
          className={cn('pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2', active ? 'text-primary' : 'text-muted-foreground')}
          aria-hidden
        />
        <label htmlFor={`${id}-preset`} className="sr-only">
          {label}
        </label>
        <select
          id={`${id}-preset`}
          value={value.preset}
          onChange={(e) => onChange({ ...value, preset: e.target.value as DatePreset })}
          className={cn(
            'h-11 rounded-md border pr-3 pl-9 text-sm',
            height,
            active ? 'border-primary bg-accent font-medium text-primary' : 'border-input bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          {DATE_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {value.preset === 'custom' && (
        <>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            From
            <Input type="date" value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: e.target.value })} className={cn('w-auto', height)} />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            To
            <Input type="date" value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value })} className={cn('w-auto', height)} />
          </label>
        </>
      )}
    </div>
  );
}
