import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-sm bg-secondary motion-reduce:animate-none', className)} {...props} />;
}

export { Skeleton };
