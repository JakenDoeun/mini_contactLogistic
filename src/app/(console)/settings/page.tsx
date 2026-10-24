import type { Metadata } from 'next';
import { serverT } from '@/lib/i18n-server';
import { SettingsView } from '@/components/settings/settings-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: await serverT('nav.settings') };
}

export default function SettingsPage() {
  return <SettingsView />;
}
