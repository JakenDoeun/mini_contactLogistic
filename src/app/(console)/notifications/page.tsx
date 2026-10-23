import type { Metadata } from 'next';
import { serverT } from '@/lib/i18n-server';
import { NotificationsView } from '@/components/notifications/notifications-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: await serverT('nav.notifications') };
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string; tab?: string }> }) {
  const { filter, tab } = await searchParams;
  return <NotificationsView initialFilter={filter} initialTab={filter || tab === 'history' ? 'history' : tab === 'by-hand' ? 'by-hand' : 'today'} />;
}
