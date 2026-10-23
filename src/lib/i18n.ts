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
  for (const m of template.matchAll(/\{(\w+)(?:, plural,|\})/g)) names.add(m[1]);
  return [...names].sort();
}
