// The settings every staff member shares (Phase 10): the export's tracking and phone column headings, the
// duplicate-file rule and the SMS wording. Until Phase 10 these lived in each browser, so the importer never saw them
// and two staff could send different wording. Admin only to change; audited by key, never by value.
import { DEFAULT_TEMPLATES } from '../../lib/parcel-logic.ts';
import { columnError, templateError, type Settings } from '../../lib/settings-logic.ts';
import { writeAudit } from '../db/audit.ts';
import type { Db } from '../db/connection.ts';
import { isAdmin, readSetting, writeSetting } from '../db/settings.ts';
import { COLUMNS_KEY, DUPLICATE_FILE_KEY, duplicateRule, importColumns } from '../importer/store.ts';

export const TEMPLATES_KEY = 'sms.templates';

export function appSettings(db: Db): Settings {
  const columns = importColumns(db);
  const t = readSetting(db, TEMPLATES_KEY) as Partial<Settings['templates']> | undefined;
  const templates = {
    single: typeof t?.single === 'string' ? t.single : DEFAULT_TEMPLATES.single,
    combined: typeof t?.combined === 'string' ? t.combined : DEFAULT_TEMPLATES.combined,
  };
  return { trackingColumn: columns.tracking, phoneColumn: columns.phone, duplicateFile: duplicateRule(db), templates };
}

export type SaveSettingsResult = { ok: true; settings: Settings } | { ok: false; reason: 'not_admin' | 'invalid'; message: string };

/** Saves the fields given; the others keep their values. Every field is checked before anything is written. */
export function saveAppSettings(db: Db, userId: number, input: Record<string, unknown>, at = new Date().toISOString()): SaveSettingsResult {
  if (!isAdmin(db, userId)) {
    writeAudit(db, { action: 'settings.refused', entity: 'settings', entityIds: [], outcome: 'refused', userId, at, detail: { error_code: 'not_admin' } });
    return { ok: false, reason: 'not_admin', message: 'Only the admin account can change these settings.' };
  }
  const invalid = (message: string): SaveSettingsResult => ({ ok: false, reason: 'invalid', message });
  const writes: [string, unknown][] = [];

  const { trackingColumn, phoneColumn, duplicateFile, templates } = input;
  if (trackingColumn !== undefined || phoneColumn !== undefined) {
    const columns = { ...((readSetting(db, COLUMNS_KEY) as Record<string, unknown> | undefined) ?? {}) };
    for (const [field, value] of [['tracking', trackingColumn], ['phone', phoneColumn]] as const) {
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.length > 100) return invalid('The column heading could not be read.');
      const error = columnError(value);
      if (error) return invalid(error);
      columns[field] = value.trim();
    }
    writes.push([COLUMNS_KEY, columns]);
  }
  if (duplicateFile !== undefined) {
    if (duplicateFile !== 'warn' && duplicateFile !== 'block') return invalid('Choose what happens with a file imported before.');
    writes.push([DUPLICATE_FILE_KEY, duplicateFile]);
  }
  if (templates !== undefined) {
    const t = templates as Partial<Record<'single' | 'combined', unknown>>;
    if (typeof t?.single !== 'string' || typeof t.combined !== 'string' || t.single.length > 600 || t.combined.length > 600) {
      return invalid('Keep each message under 600 characters.');
    }
    const error = templateError(t.single) ?? templateError(t.combined);
    if (error) return invalid(error);
    writes.push([TEMPLATES_KEY, { single: t.single.trim(), combined: t.combined.trim() }]);
  }
  if (!writes.length) return invalid('Nothing to save.');

  db.transaction(() => {
    for (const [key, value] of writes) writeSetting(db, key, value, userId, at);
    writeAudit(db, { action: 'settings.changed', entity: 'settings', entityIds: [], outcome: 'ok', userId, at, detail: { settings_keys: writes.map(([k]) => k) } });
  })();
  return { ok: true, settings: appSettings(db) };
}
