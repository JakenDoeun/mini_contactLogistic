import { Bell, FileUp, LayoutDashboard, Package, ScanBarcode, Settings, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  built: boolean;
}

export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, built: true },
  { href: '/import-arrivals', label: 'Import Arrivals', icon: FileUp, built: true },
  { href: '/parcels', label: 'Parcels', icon: Package, built: true },
  { href: '/scan', label: 'Scan Parcel', icon: ScanBarcode, built: true },
  { href: '/notifications', label: 'Notifications', icon: Bell, built: true },
  { href: '/settings', label: 'Settings', icon: Settings, built: true },
];
