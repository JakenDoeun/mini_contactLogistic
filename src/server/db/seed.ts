// Development-only demo seed: the fictional sample parcels from src/lib/mock/sample-parcels.ts, one seed import per
// arrival day. Never reads company exports.
import { SAMPLE_PARCELS } from '../../lib/mock/sample-parcels.ts';
import { writeAudit } from './audit.ts';
import type { Db } from './connection.ts';
import { insertNewParcels } from './parcels.ts';
import { nowIso } from './values.ts';

const phnomPenhDate = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);

export type SeedResult = { seeded: false; reason: string } | { seeded: true; imports: number; parcels: number };

export function seedDemoData(db: Db, nowMs = Date.now()): SeedResult {
  const counts = db.prepare("SELECT sum(source <> 'seed') AS real, sum(source = 'seed') AS demo FROM imports").get() as {
    real: number | null;
    demo: number | null;
  };
  if (counts.real) throw new Error('This database holds non-seed imports; the demo seed only runs on a development database.');
  if (counts.demo) return { seeded: false, reason: 'demo data already present' };

  const byDay = new Map<string, typeof SAMPLE_PARCELS>();
  for (const row of SAMPLE_PARCELS) {
    const day = phnomPenhDate(nowMs - row[3] * 3600_000);
    byDay.set(day, [...(byDay.get(day) ?? []), row]);
  }
  const at = nowIso();
  let parcels = 0;
  db.transaction(() => {
    for (const [day, rows] of byDay) {
      const n = rows.length;
      const importId = Number(
        db
          .prepare(
            `INSERT INTO imports (source, original_filename, stored_path, sha256, size_bytes, file_format, status, rules,
               headers_found, scan_dates, date_choice, arrival_batch_date, rows_total, rows_shopee, rows_excluded,
               excluded_codes, rows_collapsed, parcels_unique, db_duplicates, left_out, blocked, ready, parcels_added,
               checked_at, confirmed_at)
             VALUES ('seed', ?, 'demo-seed', ?, 0, NULL, 'checked', '["demo-seed"]', '{}', ?, 'single_scan_date', ?,
               ?, ?, 0, 0, 0, ?, 0, 0, 0, ?, 0, ?, NULL)`,
          )
          .run(`demo-seed-${day}`, `demo-seed-${day}`, JSON.stringify({ [day]: n }), day, n, n, n, n, at).lastInsertRowid,
      );
      const { inserted } = insertNewParcels(
        db,
        importId,
        rows.map(([code, recipient, phone]) => ({ trackingCode: code, recipientName: recipient, phoneRaw: phone, arrivalDate: day })),
        at,
      );
      db.prepare("UPDATE imports SET status = 'imported', parcels_added = ?, confirmed_at = ? WHERE id = ?").run(inserted.length, at, importId);
      writeAudit(db, {
        action: 'import.seeded', entity: 'import', entityIds: { import: [importId], parcels: inserted }, outcome: 'ok', at,
        detail: { source: 'seed', count: inserted.length, arrival_dates: [day] },
      });
      parcels += inserted.length;
    }
  })();
  return { seeded: true, imports: byDay.size, parcels };
}
