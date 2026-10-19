import { json, withSession } from '@/server/auth/guard';
import { listImports } from '@/server/importer/store';

// Import history, newest first (Import Arrivals page).
export const GET = withSession((_req, _user, db) => json({ imports: listImports(db) }));
