// Sample scenarios for the Import Arrivals page, chosen with ?preview=. The real API has none of these.
export type PreviewMode =
  | 'normal'
  | 'empty'
  | 'history-error'
  | 'unreadable'
  | 'missing-column'
  | 'monitor-active'
  | 'monitor-inactive'
  | 'monitor-error';

export const PREVIEW_MODES: { mode: PreviewMode; label: string }[] = [
  { mode: 'normal', label: 'Sample day' },
  { mode: 'empty', label: 'No imports yet' },
  { mode: 'history-error', label: 'History fails to load' },
  { mode: 'unreadable', label: 'File cannot be read' },
  { mode: 'missing-column', label: 'Tracking column missing' },
  { mode: 'monitor-active', label: 'Monitoring on' },
  { mode: 'monitor-inactive', label: 'Monitoring off' },
  { mode: 'monitor-error', label: 'Folder unreachable' },
];
