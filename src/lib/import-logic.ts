// Browser-side file rules for Import Arrivals. The server re-checks everything (src/server/importer).

export const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];
export const MAX_BYTES = 10 * 1024 * 1024;

export function validateFile(file: { name: string; size: number }): string | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return `${file.name} is not an Excel or CSV export. Choose a .xlsx, .xls or .csv file.`;
  }
  if (file.size === 0) return `${file.name} is empty. Export the file again from the logistics system.`;
  if (file.size > MAX_BYTES) return `${file.name} is larger than 10 MB. Export a shorter date range.`;
  return null;
}

export interface DaySummary {
  newRecords: number;
  duplicates: number;
  files: number;
}
