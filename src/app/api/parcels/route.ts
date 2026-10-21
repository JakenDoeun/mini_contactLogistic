import { json, withSession } from '@/server/auth/guard';
import { listParcels } from '@/server/db/parcels';
import { resolveDataDir } from '@/server/db/paths';
import { gatewayState, latestBatch, listContactEvents, restoreHold } from '@/server/sms/queue';

// Parcels, Scan Parcel, the Dashboard and Notifications: the parcels with their messages, calls and today's batch.
// Retention keeps at most 14 days, so the whole list is small.
export const GET = withSession((_req, _user, db) =>
  json({ parcels: listParcels(db), events: listContactEvents(db), batch: latestBatch(db), restoreHold: restoreHold(db), gateway: gatewayState(db, resolveDataDir()) }),
);
