import type { Metadata } from 'next';
import { PhoneSetup } from '@/components/setup/phone-setup';

export const metadata: Metadata = { title: 'Set up this phone' };

// Outside the console layout: opened over plain http on a phone that does not trust the branch yet.
export default function SetupPage() {
  return <PhoneSetup />;
}
