// The message catalogue for both the server and the browser (Phase 13). en.json is the source of every key.
// Relative imports with JSON attributes, so server code run by node (tests, scripts) can use it too.
import en from '../locales/en.json' with { type: 'json' };
import km from '../locales/km.json' with { type: 'json' };
import { format, localeFromCookie, type Locale, type Vars } from './i18n.ts';

export type MessageKey = keyof typeof en;
const CATALOG: Record<Locale, Record<string, string>> = { en, km };

/** One message in a language; an empty Khmer entry (not translated yet) falls back to English. */
export function translate(locale: Locale, key: MessageKey, vars?: Vars) {
  const own = CATALOG[locale][key];
  return format(own || en[key], vars, own ? locale : 'en');
}

/** For browser code outside React (fetch helpers): the language the switch saved in the cookie. */
export const clientT = (key: MessageKey, vars?: Vars) => translate(typeof document === 'undefined' ? 'en' : localeFromCookie(document.cookie), key, vars);

/** A message to show later: its key and values, translated where it is shown. */
export type Message = { key: MessageKey; vars?: Vars };
