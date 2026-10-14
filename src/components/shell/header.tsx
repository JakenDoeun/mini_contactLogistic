'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Menu, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { NAV } from './nav';
import { Brand, SidebarNav } from './sidebar-nav';

export function Header({ username }: { username: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = NAV.find((n) => pathname.startsWith(n.href))?.label ?? 'Parcels';

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card px-4 lg:px-8">
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
          <Menu />
        </Button>
        <SheetContent side="left" className="bg-sidebar text-white" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <Brand />
          <SidebarNav onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <nav aria-label="Breadcrumb" className="min-w-0 text-sm">
        <ol className="flex items-center gap-2">
          <li className="hidden text-muted-foreground sm:block">Campus Branch</li>
          <li className="hidden text-muted-foreground sm:block" aria-hidden>
            /
          </li>
          <li className="truncate font-medium" aria-current="page">
            {current}
          </li>
        </ol>
      </nav>

      <form
        role="search"
        className="relative ml-auto w-full max-w-xs"
        onSubmit={(e) => {
          e.preventDefault();
          const q = new FormData(e.currentTarget).get('q')?.toString().trim();
          if (q) router.push(`/parcels?q=${encodeURIComponent(q)}`);
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <label htmlFor="parcel-search" className="sr-only">
          Search parcels by tracking code, name or phone
        </label>
        <Input id="parcel-search" name="q" placeholder="Search parcels" className="pl-9" autoComplete="off" />
      </form>

      <div className="flex shrink-0 items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold uppercase" aria-hidden>
          {username.slice(0, 2)}
        </span>
        <span className="hidden text-sm xl:block">{username}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Sign out"
          title="Sign out"
          onClick={async () => {
            await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
            window.location.assign('/login');
          }}
        >
          <LogOut />
        </Button>
      </div>
    </header>
  );
}
