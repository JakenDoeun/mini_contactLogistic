import { json, withSession } from '@/server/auth/guard';
import { resolveDataDir } from '@/server/db/paths';
import { idAfter, parseDateChoice } from '@/server/importer/http';
import { reviewImport } from '@/server/importer/store';

// The review of one import; ?choice=…&date=… gives the counts for that date choice.
export const GET = withSession((req, _user, db) => {
  const id = idAfter(req, 'imports');
  if (!id) return json({ error: 'not_found' }, 404);
  const q = new URL(req.url).searchParams;
  const review = reviewImport(db, resolveDataDir(), id, parseDateChoice(q.get('choice'), q.get('date')));
  return review ? json(review) : json({ error: 'not_found' }, 404);
});
