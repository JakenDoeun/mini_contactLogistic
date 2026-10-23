import type { Metadata } from 'next';
import { serverT } from '@/lib/i18n-server';
import { ParcelBrowser } from '@/components/parcels/parcel-browser';

export async function generateMetadata(): Promise<Metadata> {
  return { title: await serverT('nav.parcels') };
}

export default async function ParcelsPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; preview?: string }> }) {
  const { q, filter, preview } = await searchParams;
  // Keyed so a new search from the header starts from that query.
  // ?preview=load-error shows the error state without breaking anything.
  return <ParcelBrowser key={`${q}|${filter}`} initialQuery={q ?? ''} initialFilter={filter} previewError={preview === 'load-error'} />;
}
