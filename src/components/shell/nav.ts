import { Bell, FileUp, LayoutDashboard, Package, ScanBarcode, Settings, type LucideIcon } from 'lucide-react';
import type { MessageKey } from '@/lib/messages';

export interface NavItem {
  href: string;
  label: MessageKey;
  icon: LucideIcon;
  built: boolean;
}

export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'nav.dashboard', icon: LayoutDashboard, built: true },
  { href: '/import-arrivals', label: 'nav.importArrivals', icon: FileUp, built: true },
  { href: '/parcels', label: 'nav.parcels', icon: Package, built: true },
  { href: '/scan', label: 'nav.scan', icon: ScanBarcode, built: true },
  { href: '/notifications', label: 'nav.notifications', icon: Bell, built: true },
  { href: '/settings', label: 'nav.settings', icon: Settings, built: true },
];
