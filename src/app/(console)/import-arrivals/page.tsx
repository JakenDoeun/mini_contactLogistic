import type { Metadata } from 'next';
import { serverT } from '@/lib/i18n-server';
import { ImportArrivals } from '@/components/import/import-arrivals';

export async function generateMetadata(): Promise<Metadata> {
  return { title: await serverT('nav.importArrivals') };
}

export default function ImportArrivalsPage() {
  return <ImportArrivals />;
}
