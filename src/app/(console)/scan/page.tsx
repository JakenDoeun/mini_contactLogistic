import type { Metadata } from 'next';
import { serverT } from '@/lib/i18n-server';
import { ScanParcel } from '@/components/parcels/scan-parcel';

export async function generateMetadata(): Promise<Metadata> {
  return { title: await serverT('nav.scan') };
}

export default function ScanPage() {
  return <ScanParcel />;
}
