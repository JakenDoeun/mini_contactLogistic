import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-11 sm:h-10 w-full rounded-md border border-input bg-card px-3 text-sm placeholder:text-muted-foreground disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
