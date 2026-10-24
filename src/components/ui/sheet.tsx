'use client';

import * as React from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n-react';

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetTitle = ({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) => (
  <SheetPrimitive.Title className={cn('text-base font-semibold', className)} {...props} />
);
const SheetDescription = ({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) => (
  <SheetPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
);

function SheetContent({
  className,
  children,
  side = 'right',
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: 'left' | 'right' }) {
  const t = useT();
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-sidebar/40" />
      <SheetPrimitive.Content
        className={cn(
          // The one shadow in the app: this panel sits above the page.
          'fixed inset-y-0 z-50 flex flex-col bg-card shadow-xl',
          side === 'right' ? 'right-0 w-full max-w-xl border-l' : 'left-0 w-72 border-r',
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          className={cn(
            'absolute top-3 right-3 inline-flex size-10 items-center justify-center rounded-md',
            // The left sheet is the navy menu, where the accent ring would be too faint.
            side === 'left' ? 'hover:bg-white/10 focus-visible:outline-white' : 'hover:bg-accent',
          )}
        >
          <X className="size-4" />
          <span className="sr-only">{t('common.close')}</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle, SheetDescription };
