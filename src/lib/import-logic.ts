// Browser-side file rules for Import Arrivals. The server re-checks everything (src/server/importer).
import type { Message } from '@/lib/messages';

export const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];
export const MAX_BYTES = 10 * 1024 * 1024;

export function validateFile(file: { name: string; size: number }): Message | null {
  const name = file.name.toLowerCase();
  const vars = { file: file.name };
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return { key: 'file.notExport', vars };
  if (file.size === 0) return { key: 'file.empty', vars };
  if (file.size > MAX_BYTES) return { key: 'file.tooLarge', vars };
  return null;
}

export interface DaySummary {
  newRecords: number;
  duplicates: number;
  files: number;
}
