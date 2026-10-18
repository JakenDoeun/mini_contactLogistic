import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { resolveDataDir } from '@/server/db/paths';
import { decideReviewItem, type ReviewDecision } from '@/server/db/review-items';
import { idAfter } from '@/server/importer/http';
import { validDecision } from '@/server/importer/store';

// A staff decision on a recipient conflict or code spelling: values picked from the file, or leave the parcel out.
// Revisable until Confirm; each decision is audited without the chosen values.
export const PUT = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const id = idAfter(req, 'review-items');
  const body = await readJson(req);
  if (!id || !body) return json({ error: 'invalid_request' }, 400);
  const chosen = body.chosen as Record<string, unknown> | undefined;
  const decision: ReviewDecision | null =
    body.resolution === 'left_out'
      ? { resolution: 'left_out' }
      : body.resolution === 'chosen' && chosen && typeof chosen === 'object' && Object.values(chosen).every((v) => typeof v === 'string')
        ? { resolution: 'chosen', chosen: chosen as Record<string, string> }
        : null;
  if (!decision) return json({ error: 'invalid_request' }, 400);
  const problem = validDecision(db, resolveDataDir(), id, decision);
  if (problem) return json({ error: 'invalid_decision', message: problem }, 400);
  try {
    decideReviewItem(db, id, decision, user.userId);
  } catch (e) {
    return json({ error: 'frozen', message: (e as Error).message }, 409);
  }
  return json({ ok: true });
});
