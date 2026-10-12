import type { Metadata } from 'next';
import { NotificationsView } from '@/components/notifications/notifications-view';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  return <NotificationsView initialFilter={filter} />;
}
