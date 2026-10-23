import type { Metadata } from 'next';
import { serverT } from '@/lib/i18n-server';
import { Dashboard } from '@/components/dashboard/dashboard';

export async function generateMetadata(): Promise<Metadata> {
  return { title: await serverT('nav.dashboard') };
}

export default function DashboardPage() {
  return <Dashboard />;
}
