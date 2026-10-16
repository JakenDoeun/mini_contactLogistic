import type { Metadata } from 'next';
import { PhoneSetup } from '@/components/setup/phone-setup';

export const metadata: Metadata = { title: 'Set up this phone' };

// Outside the console layout and open without signing in: a new phone opens it before its first sign-in.
export default function SetupPage() {
  return <PhoneSetup />;
}
