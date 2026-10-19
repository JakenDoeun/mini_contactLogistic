import { json, withSession } from '@/server/auth/guard';
import { folderState } from '@/server/folder/folder';

// The watched folder: its settings, the last check and the files waiting for review (Import Arrivals, Settings).
export const GET = withSession((_req, user, db) => json({ ...folderState(db), isAdmin: user.isAdmin }));
