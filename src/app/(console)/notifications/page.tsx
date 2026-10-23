import type { Metadata } from 'next';
import { NotificationsView } from '@/components/notifications/notifications-view';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string; tab?: string }> }) {
  const { filter, tab } = await searchParams;
  return <NotificationsView initialFilter={filter} initialTab={filter || tab === 'history' ? 'history' : tab === 'by-hand' ? 'by-hand' : 'today'} />;
}
