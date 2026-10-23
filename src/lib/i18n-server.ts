// The language on the server (Phase 13): from the cookie the language switch writes; English when there is none.
import { cookies } from 'next/headers';
import { isLocale, LOCALE_COOKIE, type Locale, type Vars } from '@/lib/i18n';
import type { ReactNode } from 'react';
import { translate, type MessageKey } from '@/lib/messages';
import { richParts } from '@/lib/rich';

export async function serverLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : 'en';
}

export const serverT = async (key: MessageKey, vars?: Vars) => translate(await serverLocale(), key, vars);

export const serverRich = async (key: MessageKey, parts: Record<string, ReactNode>, vars?: Vars) =>
  richParts(translate(await serverLocale(), key, vars), parts);
