'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n-react';

/** Marks prototype data, so nobody mistakes it for the branch database. */
export function SampleDataNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  const t = useT();
  return (
    <p className={cn('mt-4 flex flex-wrap items-center gap-2 text-sm text-info', className)}>
      <Badge variant="info">{t('common.sampleData')}</Badge>
      {children}
    </p>
  );
}
