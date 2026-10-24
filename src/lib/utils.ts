import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDate, type Locale } from './i18n.ts';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatTime = (iso: string, locale: Locale) => formatDate(new Date(iso), locale, { hour: '2-digit', minute: '2-digit' }, []);

export const formatDateTime = (iso: string, locale: Locale) =>
  formatDate(new Date(iso), locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }, []);

export const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
