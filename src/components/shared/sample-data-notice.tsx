import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Marks prototype data, so nobody mistakes it for the branch database. */
export function SampleDataNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('mt-4 flex flex-wrap items-center gap-2 text-sm text-info', className)}>
      <Badge variant="info">Sample data</Badge>
      {children}
    </p>
  );
}
