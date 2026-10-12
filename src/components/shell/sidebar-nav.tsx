'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV } from './nav';

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
      {NAV.map(({ href, label, icon: Icon, built }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-white',
              active ? 'bg-primary/35 text-white' : 'text-sidebar-foreground hover:bg-white/6 hover:text-white',
            )}
          >
            <Icon className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
            <span className="flex-1">{label}</span>
            {!built && <span className="text-xs font-normal text-sidebar-foreground">Soon</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function Brand() {
  // Product name set in type until a real logo is supplied.
  return (
    <div className="px-6 py-5">
      <p className="text-sm font-semibold text-white">Campus Branch</p>
      <p className="text-xs text-sidebar-foreground">Parcel operations</p>
    </div>
  );
}
