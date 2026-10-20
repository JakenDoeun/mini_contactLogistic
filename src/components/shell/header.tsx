'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { LogOut, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { NAV } from './nav';
import { Brand, SidebarNav } from './sidebar-nav';

export function Header({ username, isAdmin }: { username: string; isAdmin: boolean }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = NAV.find((n) => pathname.startsWith(n.href))?.label ?? 'Parcels';

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card px-4 lg:px-7">
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

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Profile username={username} isAdmin={isAdmin} />
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

/** The signed-in account. Opens on mouse hover; a tap or Enter toggles it, since phones and keyboards have no hover. */
function Profile({ username, isAdmin }: { username: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // A tap anywhere else closes it: iPhone Safari never moves focus off a tapped button, so blur alone is not enough.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div
      ref={box}
      className="relative"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="profile-card"
        aria-label={`Signed in as ${username}`}
        className="flex items-center gap-2 rounded-full"
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold uppercase">{username.slice(0, 2)}</span>
        <span className="hidden text-sm xl:block">{username}</span>
      </button>
      {open && (
        <div id="profile-card" className="absolute top-full right-0 z-40 pt-2">
          <div className="w-56 rounded-md border bg-card px-4 py-3 text-sm shadow-md">
            <p className="text-xs text-muted-foreground">Signed in as</p>
            <p className="truncate font-medium">{username}</p>
            <p className="mt-2 text-muted-foreground">{isAdmin ? 'Admin: can change settings and send a test SMS' : 'Staff'}</p>
          </div>
        </div>
      )}
    </div>
  );
}
