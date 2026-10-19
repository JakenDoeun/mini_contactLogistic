import { json, withSession } from '@/server/auth/guard';
import { listParcels } from '@/server/db/parcels';

// Parcels, Scan Parcel and the Dashboard (Phase 6). Retention keeps at most 14 days, so the whole list is small.
export const GET = withSession((_req, _user, db) => json({ parcels: listParcels(db) }));
