// The app's languages (Phase 13). Wording lives in src/locales/<locale>.json under one flat key each; en.json is the
// source and km.json the Khmer copy, filled in by the owner. Pure, so it runs under `node --test` and on the server.
//
// A message is plain text with {name} placeholders, and plurals as {count, plural, one {# parcel} other {# parcels}}
// (the option texts hold no braces; # is the number). Khmer has one plural form, so only "other" is used there.
export const LOCALES = ['en', 'km'] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = 'cb_lang';
export const LOCALE_NAME: Record<Locale, string> = { en: 'English', km: 'ខ្មែរ' };

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

/** The language in a Cookie header or document.cookie; English when none is set. */
export function localeFromCookie(cookie: string): Locale {
  const value = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`).exec(cookie)?.[1];
  return isLocale(value) ? value : 'en';
}

export type Vars = Record<string, string | number>;

const PLURAL = /\{(\w+), plural,((?:\s*(?:=\d+|zero|one|two|few|many|other)\s*\{[^{}]*\})+)\s*\}/g;
const OPTION = /(=\d+|zero|one|two|few|many|other)\s*\{([^{}]*)\}/g;

/** Fills a message's plurals and {placeholders}. A placeholder with no value stays as it is, so a gap shows. */
export function format(template: string, vars: Vars = {}, locale: Locale = 'en'): string {
  const rules = new Intl.PluralRules(locale);
  const withPlurals = template.replace(PLURAL, (whole, name: string, options: string) => {
    const n = Number(vars[name]);
    if (!Number.isFinite(n)) return whole;
    const choices = new Map([...options.matchAll(OPTION)].map((m) => [m[1], m[2]]));
    const text = choices.get(`=${n}`) ?? choices.get(rules.select(n)) ?? choices.get('other') ?? '';
    return text.replace(/#/g, String(n)); // Latin digits in both languages, as on phone numbers and labels
  });
  return withPlurals.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** The placeholder names a message uses, plurals included: a translation must use the same ones. */
export function placeholders(template: string): string[] {
  const names = new Set<string>();
  for (const m of template.matchAll(/\{(\w+),\s*plural,/g)) names.add(m[1]);
  const withoutPlurals = template.replace(PLURAL, '');
  for (const m of withoutPlurals.matchAll(/\{(\w+)\}/g)) names.add(m[1]);
  return [...names].sort();
}

const KM_MONTHS = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
const KM_DAYS: Record<string, string> = { Sun: 'អាទិត្យ', Mon: 'ច័ន្ទ', Tue: 'អង្គារ', Wed: 'ពុធ', Thu: 'ព្រហស្បតិ៍', Fri: 'សុក្រ', Sat: 'សៅរ៍' };

/**
 * A date or time in the chosen language. English keeps each screen's own format: `en` is its locale, [] meaning the
 * device's. Khmer is put together here, "សៅរ៍ 24 តុលា, 14:05" on a 24-hour clock, because Chrome ships no Khmer date
 * names (Intl falls back to English there); Intl still supplies the numbers, in the time zone asked for.
 */
export function formatDate(date: Date, locale: Locale, options: Intl.DateTimeFormatOptions, en: string | string[] = 'en-GB') {
  if (locale !== 'km') return date.toLocaleString(en, options);
  const part = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { ...options, hourCycle: 'h23', month: options.month && 'numeric', weekday: options.weekday && 'short' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const month = part.month && KM_MONTHS[Number(part.month) - 1];
  const dd = options.day === 'numeric' ? String(Number(part.day)) : part.day; // en-GB pads it beside a numeric month
  const day = [part.weekday && KM_DAYS[part.weekday], [dd, month].filter(Boolean).join(' '), part.year].filter(Boolean).join(' ');
  const time = [part.hour, part.minute, part.second].filter(Boolean).join(':');
  return [day, time].filter(Boolean).join(', ');
}
