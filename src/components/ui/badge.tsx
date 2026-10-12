import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    variant: {
      neutral: 'bg-secondary text-foreground',
      success: 'bg-success-tint text-success',
      warning: 'bg-warning-tint text-warning',
      destructive: 'bg-destructive-tint text-destructive',
      info: 'bg-info-tint text-info',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
