// Parcel storage rules the Phase 4 importer builds on: imports only ever insert new parcels, and a staff phone edit is
// the only way a parcel's phone changes (docs/phase1-schema.md, "Phones").
import { isValidPhone, normalizePhone } from '../../lib/parcel-logic.ts';
import { writeAudit } from './audit.ts';
import type { Db } from './connection.ts';
import { nowIso, trackingKey, trimSource } from './values.ts';

export interface NewParcel {
  trackingCode: string;
  recipientName: string;
  phoneRaw: string | null;
  arrivalDate: string;
}

const phoneFields = (raw: string | null) => {
  const phone = raw === null ? '' : trimSource(raw);
  return { raw: phone || null, normalized: phone && isValidPhone(phone) ? normalizePhone(phone) : null };
};

/**
 * Insert parcels whose tracking key is new; a key already stored is skipped and the stored parcel is not touched
 * (no update of its phone, name, arrival date or history). Returns the new IDs and the skipped keys.
 */
export function insertNewParcels(db: Db, importId: number, rows: NewParcel[], at = nowIso()) {
  const insert = db.prepare(
    `INSERT INTO parcels (tracking_code, tracking_key, recipient_name, import_phone_raw, phone_raw, phone_normalized,
       phone_edited, arrival_date, first_import_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
     ON CONFLICT (tracking_key) DO NOTHING
     RETURNING id`,
  );
  const inserted: number[] = [];
  const skippedKeys: string[] = [];
  db.transaction(() => {
    for (const row of rows) {
      const code = trimSource(row.trackingCode);
      const key = trackingKey(code);
      const phone = phoneFields(row.phoneRaw);
      const created = insert.get(code, key, trimSource(row.recipientName), phone.raw, phone.raw, phone.normalized, row.arrivalDate, importId, at, at) as
        | { id: number }
        | undefined;
      if (created) inserted.push(created.id);
      else skippedKeys.push(key);
    }
  })();
  return { inserted, skippedKeys };
}

/** A staff phone edit: updates the current phone and appends one parcel_phone_changes row, in one transaction. */
export function editParcelPhone(db: Db, parcelId: number, newRaw: string | null, userId: number | null, at = nowIso()) {
  db.transaction(() => {
    const current = db.prepare('SELECT phone_raw, phone_normalized FROM parcels WHERE id = ?').get(parcelId) as
      | { phone_raw: string | null; phone_normalized: string | null }
      | undefined;
    if (!current) throw new Error(`parcel ${parcelId} does not exist`);
    const phone = phoneFields(newRaw);
    db.prepare('UPDATE parcels SET phone_raw = ?, phone_normalized = ?, phone_edited = 1, updated_at = ? WHERE id = ?').run(
      phone.raw, phone.normalized, at, parcelId,
    );
    db.prepare(
      `INSERT INTO parcel_phone_changes (parcel_id, old_raw, new_raw, old_normalized, new_normalized, changed_by, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(parcelId, current.phone_raw, phone.raw, current.phone_normalized, phone.normalized, userId, at);
    writeAudit(db, {
      action: 'parcel.phone_edited', entity: 'parcel', entityIds: [parcelId], outcome: 'ok', userId, at,
      detail: { phone_valid: phone.normalized !== null },
    });
  })();
}
