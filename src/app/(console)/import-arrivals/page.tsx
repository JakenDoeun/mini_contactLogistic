import type { Metadata } from 'next';
import { ImportArrivals } from '@/components/import/import-arrivals';

export const metadata: Metadata = { title: 'Import Arrivals' };

export default function ImportArrivalsPage() {
  return <ImportArrivals />;
}
