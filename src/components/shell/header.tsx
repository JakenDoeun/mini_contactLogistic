'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { LogOut, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import type { StaticImageData } from 'next/image';
import gbFlag from 'flag-icons/flags/4x3/gb.svg';
import khFlag from 'flag-icons/flags/4x3/kh.svg';
import { LOCALES, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useLocale, useT } from '@/lib/i18n-react';
import { NAV } from './nav';
import { Brand, SidebarNav } from './sidebar-nav';

export function Header({ username, isAdmin }: { username: string; isAdmin: boolean }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const t = useT();
  const current = t(NAV.find((n) => pathname.startsWith(n.href))?.label ?? 'nav.parcels');

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card px-4 lg:px-3.5">
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenuOpen(true)} aria-label={t('header.openMenu')}>
          <Menu />
        </Button>
        <SheetContent side="left" className="bg-sidebar text-white" aria-describedby={undefined}>
          <SheetTitle className="sr-only">{t('header.menu')}</SheetTitle>
          <Brand />
          <SidebarNav onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <nav aria-label={t('header.breadcrumb')} className="min-w-0 text-sm">
        <ol className="flex items-center gap-2">
          <li className="hidden text-muted-foreground sm:block">{t('brand.name')}</li>
          <li className="hidden text-muted-foreground sm:block" aria-hidden>
            /
          </li>
          <li className="truncate font-medium" aria-current="page">
            {current}
          </li>
        </ol>
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <LanguageSwitch />
        <Profile username={username} isAdmin={isAdmin} />
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('header.signOut')}
          title={t('header.signOut')}
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
  const t = useT();
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
        aria-label={t('header.signedInAs', { username })}
        className="flex items-center gap-2 rounded-full"
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold uppercase">{username.slice(0, 2)}</span>
        <span className="hidden text-sm xl:block">{username}</span>
      </button>
      {open && (
        <div id="profile-card" className="absolute top-full right-0 z-40 pt-2">
          <div className="w-56 rounded-md border bg-card px-4 py-3 text-sm shadow-md">
            <p className="text-xs text-muted-foreground">{t('header.signedInAsLabel')}</p>
            <p className="truncate font-medium">{username}</p>
            <p className="mt-2 text-muted-foreground">{isAdmin ? t('header.roleAdmin') : t('header.roleStaff')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Flags from flag-icons (MIT), drawn 4:3. The label names the language; the flag only helps the eye find it.
const LANGS: Record<Locale, { flag: StaticImageData | string; code: string; label: string }> = {
  en: { flag: gbFlag, code: 'EN', label: 'English' },
  km: { flag: khFlag, code: 'KM', label: 'Khmer' },
};
// Turbopack turns an SVG from node_modules into a plain URL; one from src would be image data.
const flagSrc = (f: StaticImageData | string) => (typeof f === 'string' ? f : f.src);

/**
 * English or Khmer, for this device (Phase 13). Two radio buttons, no box: a lavender pill slides under the chosen
 * one, arrow keys move between them, and only the chosen one is a Tab stop.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const refs = useRef<Partial<Record<Locale, HTMLButtonElement | null>>>({});
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = LOCALES.indexOf(locale);
    const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: LOCALES.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const l = LOCALES[(next + LOCALES.length) % LOCALES.length];
    setLocale(l);
    refs.current[l]?.focus();
  };
  return (
    // A span, since the sign-in page puts it inside a paragraph.
    <span
      role="radiogroup"
      aria-label={t('language.label')}
      onKeyDown={onKeyDown}
      className={cn(
        'relative inline-grid shrink-0 grid-cols-2 rounded-full p-1',
        className,
      )}
    >
      {/* The pill: one column wide, it slides to the chosen language with a small overshoot. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-selection shadow-[0_1px_3px_rgb(64_73_184/0.22)]',
          'transition-transform duration-300 ease-[cubic-bezier(0.34,1.45,0.64,1)] motion-reduce:transition-none',
          locale === 'km' && 'translate-x-full',
        )}
      />
      {LOCALES.map((l) => {
        const on = locale === l;
        return (
          <button
            key={l}
            ref={(el) => {
              refs.current[l] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={LANGS[l].label}
            tabIndex={on ? 0 : -1}
            onClick={() => setLocale(l)}
            className={cn(
              'group relative flex h-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold tracking-wide transition-colors duration-200 sm:h-8 sm:px-3',
              on ? 'text-primary-hover' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <img
              src={flagSrc(LANGS[l].flag)}
              alt=""
              width={16}
              height={12}
              className={cn(
                'h-3 w-4 shrink-0 rounded-[3px] object-cover shadow-[0_0_0_1px_rgb(27_32_51/0.12)] transition-transform duration-300 ease-[cubic-bezier(0.34,1.45,0.64,1)] motion-reduce:transition-none',
                on ? 'scale-110' : 'group-hover:-rotate-6 group-hover:scale-110',
              )}
            />
            {/* Flags only on phones, so the page name beside it still fits; the label still says the language. */}
            <span className="hidden sm:inline">{LANGS[l].code}</span>
          </button>
        );
      })}
    </span>
  );
}
