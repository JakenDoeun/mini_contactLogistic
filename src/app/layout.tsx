import type { Metadata } from 'next';
import { GeistMono } from 'geist/font/mono';
import localFont from 'next/font/local';
import { LocaleProvider } from '@/lib/i18n-react';
import { serverLocale, serverT } from '@/lib/i18n-server';
import './globals.css';

// Kantumruy Pro for both languages (owner's pick, 2026-10-23): its Latin and Khmer are drawn as one family, so mixed
// lines read as one font, the same on every phone and PC. Khmer is drawn at 95%, so switching language no longer looks
// like zooming in (owner, 2026-10-24): at 105% a consonant stood 28% taller than the Latin lowercase and read as bigger
// text; at 85% (level with it) Khmer read as smaller. At 95% it stands 16% taller, which reads as the same size.
const latin = localFont({
  src: '../../node_modules/@fontsource-variable/kantumruy-pro/files/kantumruy-pro-latin-wght-normal.woff2',
  weight: '100 700',
  variable: '--font-latin',
});
const khmer = localFont({
  src: '../../node_modules/@fontsource-variable/kantumruy-pro/files/kantumruy-pro-khmer-wght-normal.woff2',
  weight: '100 700',
  variable: '--font-khmer',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: 'unicode-range', value: 'U+1780-17FF, U+19E0-19FF, U+200C-200D, U+25CC' },
    { prop: 'size-adjust', value: '95%' },
  ],
});

export async function generateMetadata(): Promise<Metadata> {
  return { title: await serverT('app.title'), description: await serverT('app.description') };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await serverLocale();
  return (
    <html lang={locale} className={`${latin.variable} ${GeistMono.variable} ${khmer.variable}`}>
      <body>
        <LocaleProvider initial={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
