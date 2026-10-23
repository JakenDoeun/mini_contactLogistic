// The message catalogue for both the server and the browser (Phase 13). en.json is the source of every key.
import en from '@/locales/en.json';
import km from '@/locales/km.json';
import { format, type Locale, type Vars } from '@/lib/i18n';

export type MessageKey = keyof typeof en;
const CATALOG: Record<Locale, Record<string, string>> = { en, km };

/** One message in a language; an empty Khmer entry (not translated yet) falls back to English. */
export function translate(locale: Locale, key: MessageKey, vars?: Vars) {
  const own = CATALOG[locale][key];
  return format(own || en[key], vars, own ? locale : 'en');
}
