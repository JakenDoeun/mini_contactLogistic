import { json, refuseCrossSite, withSession } from '@/server/auth/guard';
import { resolveDataDir } from '@/server/db/paths';
import { checkImport } from '@/server/importer/store';

const MAX_BYTES = 10 * 1024 * 1024;

// Upload a courier export and check it (docs/import-rules.md). The result is saved for review; nothing is imported
// until a staff member confirms it.
export const POST = withSession(async (req, user, db) => {
  const refused = await refuseCrossSite(req);
  if (refused) return refused;
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES + 64 * 1024) return json({ error: 'too_large' }, 413);
  let file: FormDataEntryValue | null = null;
  try {
    file = (await req.formData()).get('file');
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  if (!(file instanceof File) || file.size === 0) return json({ error: 'no_file' }, 400);
  if (file.size > MAX_BYTES) return json({ error: 'too_large' }, 413);
  const result = checkImport(db, resolveDataDir(), {
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    source: 'manual',
    userId: user.userId,
  });
  return json(result, result.status === 'failed' ? 422 : 201);
});
