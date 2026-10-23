import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { LocaleProvider } from '@/lib/i18n-react';
import { serverLocale, serverT } from '@/lib/i18n-server';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: await serverT('app.title'), description: await serverT('app.description') };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await serverLocale();
  return (
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <LocaleProvider initial={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
