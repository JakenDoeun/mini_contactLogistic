import type { Metadata } from 'next';
import { ScanParcel } from '@/components/parcels/scan-parcel';

export const metadata: Metadata = { title: 'Scan Parcel' };

export default function ScanPage() {
  return <ScanParcel />;
}
