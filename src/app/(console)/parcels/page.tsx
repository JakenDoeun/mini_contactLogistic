import type { Metadata } from 'next';
import { ParcelBrowser } from '@/components/parcels/parcel-browser';

export const metadata: Metadata = { title: 'Parcels' };

export default async function ParcelsPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; preview?: string }> }) {
  const { q, filter, preview } = await searchParams;
  // Keyed so a new search from the header starts from that query.
  // ?preview=load-error shows the error state; the mock data itself never fails.
  return <ParcelBrowser key={`${q}|${filter}`} initialQuery={q ?? ''} initialFilter={filter} loadFailed={preview === 'load-error'} />;
}
