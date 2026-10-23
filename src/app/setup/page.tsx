import type { Metadata } from 'next';
import { serverT } from '@/lib/i18n-server';
import { PhoneSetup } from '@/components/setup/phone-setup';

export async function generateMetadata(): Promise<Metadata> {
  return { title: await serverT('page.setup') };
}

// Outside the console layout and open without signing in: a new phone opens it before its first sign-in.
export default function SetupPage() {
  return <PhoneSetup />;
}
