// Staff decisions on import review items (owner decision on review finding I3, 2026-10-14): a decision may be revised
// any number of times while its import is `checked`; Confirm (or cancel/fail) freezes it, enforced by the
// review_items_update_while_checked trigger. Each decision is audited with safe metadata only: the chosen name, phone or
// spelling stays in the review item and never reaches the audit log.
import { writeAudit } from './audit.ts';
import type { Db } from './connection.ts';
import { nowIso } from './values.ts';

export type ReviewDecision = { resolution: 'chosen'; chosen: Record<string, string> } | { resolution: 'left_out' };

export function decideReviewItem(db: Db, itemId: number, decision: ReviewDecision, userId: number | null, at = nowIso()) {
  db.transaction(() => {
    const item = db
      .prepare(
        `SELECT i.import_id, i.kind, i.resolution, m.status FROM import_review_items i JOIN imports m ON m.id = i.import_id WHERE i.id = ?`,
      )
      .get(itemId) as { import_id: number; kind: string; resolution: string | null; status: string } | undefined;
    if (!item) throw new Error(`review item ${itemId} does not exist`);
    if (item.status !== 'checked') throw new Error(`review item ${itemId} is frozen: its import is ${item.status}`);
    const chosen = decision.resolution === 'chosen' ? JSON.stringify(decision.chosen) : null;
    db.prepare('UPDATE import_review_items SET resolution = ?, chosen = ?, resolved_by = ?, resolved_at = ? WHERE id = ?').run(
      decision.resolution, chosen, userId, at, itemId,
    );
    writeAudit(db, {
      action: 'import.review_decided', entity: 'import_review_item', entityIds: { import: [item.import_id], review_item: [itemId] },
      outcome: 'ok', userId, at,
      detail: { item_kind: item.kind, resolution_from: item.resolution, resolution_to: decision.resolution },
    });
  })();
}
