// Audit log writer (docs/phase1-schema.md, table 16): action, record IDs, outcome, time and safe metadata only.
// Never names, phone numbers, message bodies or credentials: detail keys come from an allow-list and every
// string value is checked for phone-shaped text.
import type { Db } from './connection.ts';
import { nowIso } from './values.ts';

const DETAIL_KEYS = new Set([
  'count', 'counts', 'rules', 'status_from', 'status_to', 'settings_keys', 'error_code', 'file_name', 'sha256',
  'phone_valid', 'migrations_applied', 'arrival_dates', 'source', 'item_kind', 'resolution_from', 'resolution_to',
]);
// Keys whose value must come from a closed set, so no free text can ride on them.
const CLOSED_SETS: Record<string, readonly (string | null)[]> = {
  item_kind: ['recipient_conflict', 'code_spelling', 'db_duplicate', 'not_chosen_scan_date', 'excluded_by_staff', 'unparseable_scan_time'],
  resolution_from: [null, 'chosen', 'left_out'],
  resolution_to: ['chosen', 'left_out'],
};
const PHONE_SHAPED = /(?:\+?855|(?<!\d)0)[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{3,4}(?!\d)/;

export type AuditEntityIds = number[] | Record<string, number[]>;
export interface AuditEntry {
  action: string;
  entity: string;
  entityIds: AuditEntityIds;
  outcome: 'ok' | 'failed' | 'refused';
  userId?: number | null;
  detail?: Record<string, unknown>;
  at?: string;
}

const SHA256 = /^[0-9a-f]{64}$/;

function checkValue(key: string, value: unknown): void {
  // A hash is validated by its exact format: its digit runs often look like phone numbers (about 1 in 55 hashes).
  if (key === 'sha256') {
    if (typeof value !== 'string' || !SHA256.test(value)) throw new Error('audit detail "sha256" must be 64 lower-case hex characters');
    return;
  }
  if (key in CLOSED_SETS) {
    if (!CLOSED_SETS[key].includes(value as string | null)) throw new Error(`audit detail "${key}" has a value outside its allowed set`);
    return;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (value.length > 200) throw new Error(`audit detail "${key}" is too long`);
    if (PHONE_SHAPED.test(value)) throw new Error(`audit detail "${key}" looks like a phone number`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((v) => checkValue(key, v));
  if (typeof value === 'object') return Object.entries(value).forEach(([k, v]) => checkValue(`${key}.${k}`, v));
  throw new Error(`audit detail "${key}" has an unsupported type`);
}

const isIdList = (v: unknown) => Array.isArray(v) && v.every((n) => Number.isInteger(n));

export function writeAudit(db: Db, entry: AuditEntry): number {
  if (!/^[a-z_]+\.[a-z_]+$/.test(entry.action)) throw new Error(`audit action "${entry.action}" must look like entity.verb`);
  if (!/^[a-z_]+$/.test(entry.entity)) throw new Error(`audit entity "${entry.entity}" is not a plain name`);
  const ids = entry.entityIds;
  if (!(isIdList(ids) || (typeof ids === 'object' && Object.values(ids).every(isIdList)))) {
    throw new Error('audit entity_ids must be record IDs');
  }
  const detail = entry.detail ?? {};
  for (const [key, value] of Object.entries(detail)) {
    if (!DETAIL_KEYS.has(key)) throw new Error(`audit detail key "${key}" is not allowed`);
    checkValue(key, value);
  }
  const result = db
    .prepare('INSERT INTO audit_log (at, user_id, action, entity, entity_ids, outcome, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(entry.at ?? nowIso(), entry.userId ?? null, entry.action, entry.entity, JSON.stringify(ids), entry.outcome, JSON.stringify(detail));
  return Number(result.lastInsertRowid);
}
