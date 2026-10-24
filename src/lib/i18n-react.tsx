'use client';

// The language in React (Phase 13): the server reads the cookie so the first paint is already in the chosen language;
// switching writes the cookie and refreshes the server parts. Each device keeps its own choice.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LOCALE_COOKIE, type Locale, type Vars } from '@/lib/i18n';
import { translate, type MessageKey } from '@/lib/messages';
import { richParts } from '@/lib/rich';

export type { MessageKey };

const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({ locale: 'en', setLocale: () => {} });

export function LocaleProvider({ initial, children }: { initial: Locale; children: React.ReactNode }) {
  const [locale, set] = useState(initial);
  const router = useRouter();
  const setLocale = useCallback(
    (next: Locale) => {
      set(next);
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = next;
      router.refresh(); // server-rendered parts (page titles) follow
    },
    [router],
  );
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);

/**
 * t('key', { vars }) in the chosen language; t.rich('key', { command: <code>…</code> }, vars) when the sentence holds
 * elements.
 */
export function useT() {
  const { locale } = useContext(LocaleContext);
  return useMemo(() => {
    const t = (key: MessageKey, vars?: Vars) => translate(locale, key, vars);
    t.rich = (key: MessageKey, parts: Record<string, ReactNode>, vars?: Vars) => richParts(translate(locale, key, vars), parts);
    t.locale = locale; // for dates: formatDate(…, t.locale, …)
    return t;
  }, [locale]);
}
