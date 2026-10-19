import { json, readJson, refuseCrossSite, withSession } from '@/server/auth/guard';
import { resolveDataDir } from '@/server/db/paths';
import { idAfter, parseDateChoice } from '@/server/importer/http';
import { confirmImport } from '@/server/importer/store';

// Confirm: one transaction that adds only new parcels (docs/import-rules.md). A refusal changes nothing.
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  const id = idAfter(req, 'imports');
  const body = await readJson(req);
  const choice = body && parseDateChoice(body.dateChoice, body.chosenScanDate);
  if (!id || !body || !choice || typeof body.arrivalBatchDate !== 'string') return json({ error: 'invalid_request' }, 400);
  const result = confirmImport(db, resolveDataDir(), id, {
    arrivalBatchDate: body.arrivalBatchDate,
    dateChoice: choice,
    batchDateChosen: body.batchDateChosen === true,
    userId: user.userId,
  });
  if (result.ok) return json(result);
  return json(result, result.reason === 'not_found' ? 404 : result.reason === 'failed' ? 500 : 409);
});
