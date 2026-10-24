// Approved Phase 1 schema (docs/phase1-schema.md, decisions 31–37): 18 tables, plus `recovery_codes` (Phase 2, 0002)
// and `users.is_admin` (Phase 3, 0003).
// Triggers (append-only tables, import status changes) are not expressible here; they live in the migration SQL.
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

// Format only; that the date exists on the calendar (no 2026-02-30) is enforced by triggers in drizzle/0001.
const LOCAL_DATE = "'[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'";
const localDate = (c: SQLiteColumn, nullable = false): SQL =>
  nullable ? sql`${c} IS NULL OR ${c} GLOB ${sql.raw(LOCAL_DATE)}` : sql`${c} GLOB ${sql.raw(LOCAL_DATE)}`;
const oneOf = (c: SQLiteColumn, values: string[], nullable = false): SQL => {
  const list = sql.raw(values.map((v) => `'${v}'`).join(', '));
  return nullable ? sql`${c} IS NULL OR ${c} IN (${list})` : sql`${c} IN (${list})`;
};
const bool = (c: SQLiteColumn): SQL => sql`${c} IN (0, 1)`;
const json = (c: SQLiteColumn, nullable = false): SQL =>
  nullable ? sql`${c} IS NULL OR json_valid(${c})` : sql`json_valid(${c})`;
const nonNegative = (...cs: SQLiteColumn[]): SQL => sql.join(cs.map((c) => sql`${c} >= 0`), sql` AND `);

const restrict = { onDelete: 'restrict', onUpdate: 'restrict' } as const;

// ---- Parcels and imports -------------------------------------------------------------------

export const parcels = sqliteTable(
  'parcels',
  {
    id: integer('id').primaryKey(),
    trackingCode: text('tracking_code').notNull(),
    trackingKey: text('tracking_key').notNull(),
    recipientName: text('recipient_name').notNull(),
    importPhoneRaw: text('import_phone_raw'),
    phoneRaw: text('phone_raw'),
    phoneNormalized: text('phone_normalized'),
    phoneEdited: integer('phone_edited').notNull().default(0),
    arrivalDate: text('arrival_date').notNull(),
    firstImportId: integer('first_import_id').notNull().references((): AnySQLiteColumn => imports.id, restrict),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('parcels_tracking_key_unique').on(t.trackingKey),
    index('parcels_arrival_phone_idx').on(t.arrivalDate, t.phoneNormalized),
    index('parcels_phone_idx').on(t.phoneNormalized),
    index('parcels_recipient_idx').on(t.recipientName),
    check('parcels_tracking_code_nonempty', sql`length(${t.trackingCode}) > 0 AND ${t.trackingCode} = trim(${t.trackingCode})`),
    // SQLite's built-in upper() changes ASCII a-z only, which is exactly the tracking-code-key/v1 rule.
    check('parcels_tracking_key_rule', sql`${t.trackingKey} = upper(${t.trackingCode})`),
    check('parcels_phone_edited_bool', bool(t.phoneEdited)),
    check('parcels_phone_unedited', sql`${t.phoneEdited} = 1 OR ${t.phoneRaw} IS ${t.importPhoneRaw}`),
    check('parcels_arrival_date', localDate(t.arrivalDate)),
  ],
);

export const imports = sqliteTable(
  'imports',
  {
    id: integer('id').primaryKey(),
    source: text('source').notNull(),
    detectedFileId: integer('detected_file_id').references((): AnySQLiteColumn => detectedFiles.id, restrict),
    originalFilename: text('original_filename').notNull(),
    storedPath: text('stored_path').notNull(),
    sha256: text('sha256').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    fileFormat: text('file_format'),
    status: text('status').notNull(),
    rerunOfImportId: integer('rerun_of_import_id').references((): AnySQLiteColumn => imports.id, restrict),
    rules: text('rules').notNull(),
    headersFound: text('headers_found').notNull(),
    timeZoneAssumed: text('time_zone_assumed').notNull().default('Asia/Phnom_Penh'),
    scanDates: text('scan_dates').notNull(),
    dateChoice: text('date_choice'),
    chosenScanDate: text('chosen_scan_date'),
    arrivalBatchDate: text('arrival_batch_date'),
    arrivalDateChanged: integer('arrival_date_changed').notNull().default(0),
    rowsTotal: integer('rows_total').notNull(),
    rowsShopee: integer('rows_shopee').notNull(),
    rowsExcluded: integer('rows_excluded').notNull(),
    excludedCodes: integer('excluded_codes').notNull(),
    rowsCollapsed: integer('rows_collapsed').notNull(),
    parcelsUnique: integer('parcels_unique').notNull(),
    dbDuplicates: integer('db_duplicates').notNull(),
    leftOut: integer('left_out').notNull(),
    blocked: integer('blocked').notNull(),
    ready: integer('ready').notNull(),
    parcelsAdded: integer('parcels_added').notNull().default(0),
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
    checkedAt: text('checked_at').notNull(),
    checkedBy: integer('checked_by').references((): AnySQLiteColumn => users.id, restrict),
    confirmedAt: text('confirmed_at'),
    confirmedBy: integer('confirmed_by').references((): AnySQLiteColumn => users.id, restrict),
  },
  (t) => [
    index('imports_sha256_idx').on(t.sha256),
    index('imports_status_idx').on(t.status),
    index('imports_rerun_idx').on(t.rerunOfImportId),
    check('imports_source', oneOf(t.source, ['manual', 'folder', 'seed'])),
    check('imports_file_format', oneOf(t.fileFormat, ['xlsx', 'xls', 'csv'], true)),
    check('imports_status', oneOf(t.status, ['checked', 'imported', 'no_eligible_rows', 'failed', 'cancelled'])),
    check('imports_rules_json', json(t.rules)),
    check('imports_headers_json', json(t.headersFound)),
    check('imports_scan_dates_json', json(t.scanDates)),
    check('imports_date_choice', oneOf(t.dateChoice, ['single_scan_date', 'all_on_batch_date', 'only_scan_date'], true)),
    check(
      'imports_chosen_scan_date',
      sql`(coalesce(${t.dateChoice}, '') = 'only_scan_date') = (${t.chosenScanDate} IS NOT NULL) AND (${localDate(t.chosenScanDate, true)})`,
    ),
    check('imports_arrival_batch_date', localDate(t.arrivalBatchDate, true)),
    check('imports_arrival_date_changed_bool', bool(t.arrivalDateChanged)),
    check(
      'imports_counts_non_negative',
      nonNegative(
        t.sizeBytes, t.rowsTotal, t.rowsShopee, t.rowsExcluded, t.excludedCodes, t.rowsCollapsed,
        t.parcelsUnique, t.dbDuplicates, t.leftOut, t.blocked, t.ready, t.parcelsAdded,
      ),
    ),
    check('imports_rows_identity', sql`${t.rowsTotal} = ${t.rowsShopee} + ${t.rowsExcluded}`),
    check('imports_collapsed_identity', sql`${t.rowsCollapsed} = ${t.rowsShopee} - ${t.parcelsUnique}`),
    check('imports_parcels_identity', sql`${t.parcelsUnique} = ${t.dbDuplicates} + ${t.leftOut} + ${t.blocked} + ${t.ready}`),
    // Import status rules: only `imported` has a confirmation and inserted parcels.
    check(
      'imports_status_rules',
      sql`CASE ${t.status}
        WHEN 'imported' THEN ${t.confirmedAt} IS NOT NULL AND ${t.arrivalBatchDate} IS NOT NULL AND ${t.dateChoice} IS NOT NULL AND ${t.parcelsAdded} = ${t.ready} AND ${t.blocked} = 0
        WHEN 'failed' THEN ${t.confirmedAt} IS NULL AND ${t.parcelsAdded} = 0 AND ${t.errorCode} IS NOT NULL
        ELSE ${t.confirmedAt} IS NULL AND ${t.parcelsAdded} = 0
      END`,
    ),
  ],
);

export const importReviewItems = sqliteTable(
  'import_review_items',
  {
    id: integer('id').primaryKey(),
    importId: integer('import_id').notNull().references(() => imports.id, restrict),
    trackingKey: text('tracking_key').notNull(),
    kind: text('kind').notNull(),
    blocking: integer('blocking').notNull(),
    detail: text('detail').notNull(),
    parcelScanDate: text('parcel_scan_date'),
    existingParcelId: integer('existing_parcel_id').references(() => parcels.id, restrict),
    resolution: text('resolution'),
    chosen: text('chosen'),
    resolvedBy: integer('resolved_by').references(() => users.id, restrict),
    resolvedAt: text('resolved_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('review_items_import_key_kind_unique').on(t.importId, t.trackingKey, t.kind),
    index('review_items_open_idx').on(t.importId, t.blocking, t.resolution),
    index('review_items_key_idx').on(t.trackingKey),
    check(
      'review_items_kind',
      oneOf(t.kind, ['recipient_conflict', 'code_spelling', 'db_duplicate', 'not_chosen_scan_date', 'excluded_by_staff', 'unparseable_scan_time']),
    ),
    check('review_items_blocking', sql`${t.blocking} = (${t.kind} IN ('recipient_conflict', 'code_spelling'))`),
    check('review_items_detail_json', json(t.detail)),
    check('review_items_chosen_json', json(t.chosen, true)),
    check('review_items_resolution', oneOf(t.resolution, ['chosen', 'left_out'], true)),
    check('review_items_resolved_at', sql`${t.resolution} IS NULL OR ${t.resolvedAt} IS NOT NULL`),
    check('review_items_chosen_present', sql`coalesce(${t.resolution}, '') <> 'chosen' OR ${t.chosen} IS NOT NULL`),
    check('review_items_scan_date', localDate(t.parcelScanDate, true)),
  ],
);

export const parcelScanEvents = sqliteTable(
  'parcel_scan_events',
  {
    id: integer('id').primaryKey(),
    parcelId: integer('parcel_id').notNull().references(() => parcels.id, restrict),
    importId: integer('import_id').notNull().references(() => imports.id, restrict),
    sourceRow: integer('source_row').notNull(),
    trackingCodeRaw: text('tracking_code_raw').notNull(),
    scanTypeRaw: text('scan_type_raw'),
    scanTimeRaw: text('scan_time_raw'),
    scanTimeUtc: text('scan_time_utc'),
    scanDate: text('scan_date'),
    scanSiteRaw: text('scan_site_raw'),
    uploadTimeRaw: text('upload_time_raw'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('scan_events_import_row_unique').on(t.importId, t.sourceRow),
    index('scan_events_parcel_idx').on(t.parcelId),
    check('scan_events_source_row', sql`${t.sourceRow} > 0`),
    check('scan_events_parsed_pair', sql`(${t.scanTimeUtc} IS NULL) = (${t.scanDate} IS NULL)`),
    // A parsed time exists only for a canonical, real YYYY-MM-DD HH:MM:SS text (Asia/Phnom_Penh, UTC+7) and must match it.
    check(
      'scan_events_parsed_matches_raw',
      sql`${t.scanTimeUtc} IS NULL OR (
        ${t.scanTimeRaw} IS NOT NULL
        AND strftime('%Y-%m-%d %H:%M:%S', ${t.scanTimeRaw}) IS ${t.scanTimeRaw}
        AND ${t.scanTimeUtc} IS strftime('%Y-%m-%dT%H:%M:%fZ', ${t.scanTimeRaw}, '-7 hours')
        AND ${t.scanDate} IS substr(${t.scanTimeRaw}, 1, 10)
      )`,
    ),
  ],
);

export const detectedFiles = sqliteTable(
  'detected_files',
  {
    id: integer('id').primaryKey(),
    path: text('path').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    modifiedAt: text('modified_at').notNull(),
    sha256: text('sha256'),
    state: text('state').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    importId: integer('import_id').references((): AnySQLiteColumn => imports.id, restrict),
  },
  (t) => [
    uniqueIndex('detected_files_identity_unique').on(t.path, t.sizeBytes, t.modifiedAt),
    index('detected_files_sha256_idx').on(t.sha256),
    check('detected_files_state', oneOf(t.state, ['waiting', 'unreadable', 'imported', 'dismissed'])),
  ],
);

export const parcelPhoneChanges = sqliteTable(
  'parcel_phone_changes',
  {
    id: integer('id').primaryKey(),
    parcelId: integer('parcel_id').notNull().references(() => parcels.id, restrict),
    oldRaw: text('old_raw'),
    newRaw: text('new_raw'),
    oldNormalized: text('old_normalized'),
    newNormalized: text('new_normalized'),
    changedBy: integer('changed_by').references(() => users.id, restrict),
    changedAt: text('changed_at').notNull(),
  },
  (t) => [index('phone_changes_parcel_idx').on(t.parcelId)],
);

// ---- Notifications and contact -------------------------------------------------------------

export const sendBatches = sqliteTable(
  'send_batches',
  {
    id: integer('id').primaryKey(),
    requestKey: text('request_key').notNull(),
    arrivalDate: text('arrival_date').notNull(),
    plannedMessages: integer('planned_messages').notNull(),
    plannedParcels: integer('planned_parcels').notNull(),
    status: text('status').notNull(),
    createdBy: integer('created_by').references(() => users.id, restrict),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('send_batches_request_key_unique').on(t.requestKey),
    check('send_batches_status', oneOf(t.status, ['running', 'paused', 'stopped', 'done'])),
    check('send_batches_arrival_date', localDate(t.arrivalDate)),
    check('send_batches_counts', nonNegative(t.plannedMessages, t.plannedParcels)),
  ],
);

export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey(),
    phoneNormalized: text('phone_normalized').notNull(),
    arrivalDate: text('arrival_date').notNull(),
    messageText: text('message_text').notNull(),
    reason: text('reason').notNull(),
    batchId: integer('batch_id').references(() => sendBatches.id, restrict),
    createdBy: integer('created_by').references(() => users.id, restrict),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('notifications_phone_idx').on(t.phoneNormalized),
    index('notifications_arrival_phone_idx').on(t.arrivalDate, t.phoneNormalized),
    check('notifications_reason', oneOf(t.reason, ['initial', 'resend'])),
    check('notifications_arrival_date', localDate(t.arrivalDate)),
  ],
);

export const notificationParcels = sqliteTable(
  'notification_parcels',
  {
    notificationId: integer('notification_id').notNull().references(() => notifications.id, restrict),
    parcelId: integer('parcel_id').notNull().references(() => parcels.id, restrict),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.parcelId] }), index('notification_parcels_parcel_idx').on(t.parcelId)],
);

export const smsAttempts = sqliteTable(
  'sms_attempts',
  {
    id: text('id').primaryKey(),
    notificationId: integer('notification_id').notNull().references(() => notifications.id, restrict),
    attemptNo: integer('attempt_no').notNull(),
    state: text('state').notNull(),
    gatewayState: text('gateway_state'),
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
    queuedAt: text('queued_at').notNull(),
    submittedAt: text('submitted_at'),
    sentAt: text('sent_at'),
    deliveredAt: text('delivered_at'),
    failedAt: text('failed_at'),
    lastCheckedAt: text('last_checked_at'),
    resolvedBy: integer('resolved_by').references(() => users.id, restrict),
    /** The gateway phone's SIM slot (1-based) chosen for the customer's carrier; null before Phase 12. */
    simNumber: integer('sim_number'),
  },
  (t) => [
    uniqueIndex('sms_attempts_notification_attempt_unique').on(t.notificationId, t.attemptNo),
    index('sms_attempts_state_idx').on(t.state),
    check(
      'sms_attempts_state',
      oneOf(t.state, ['queued', 'submitting', 'submitted', 'sent', 'delivered', 'failed', 'unconfirmed', 'cancelled']),
    ),
    check('sms_attempts_attempt_no', sql`${t.attemptNo} >= 1`),
    check('sms_attempts_sim_number', sql`${t.simNumber} IS NULL OR ${t.simNumber} BETWEEN 1 AND 8`),
  ],
);

export const contactAttempts = sqliteTable(
  'contact_attempts',
  {
    id: integer('id').primaryKey(),
    channel: text('channel').notNull(),
    outcome: text('outcome').notNull(),
    note: text('note'),
    phoneNormalized: text('phone_normalized'),
    createdBy: integer('created_by').references(() => users.id, restrict),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('contact_attempts_phone_idx').on(t.phoneNormalized),
    check('contact_attempts_channel', oneOf(t.channel, ['call', 'telegram', 'other', 'flag'])),
    check('contact_attempts_outcome', oneOf(t.outcome, ['reached', 'no_answer', 'attempted', 'messaged', 'follow_up'])),
  ],
);

export const contactAttemptParcels = sqliteTable(
  'contact_attempt_parcels',
  {
    contactAttemptId: integer('contact_attempt_id').notNull().references(() => contactAttempts.id, restrict),
    parcelId: integer('parcel_id').notNull().references(() => parcels.id, restrict),
  },
  (t) => [primaryKey({ columns: [t.contactAttemptId, t.parcelId] }), index('contact_attempt_parcels_parcel_idx').on(t.parcelId)],
);

// ---- System --------------------------------------------------------------------------------

export const settings = sqliteTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    updatedBy: integer('updated_by').references(() => users.id, restrict),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [check('settings_value_json', json(t.value))],
);

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    disabled: integer('disabled').notNull().default(0),
    createdAt: text('created_at').notNull(),
    // Plan Revision 4: only an admin changes the data retention setting. The first account is the admin.
    isAdmin: integer('is_admin').notNull().default(0),
  },
  (t) => [
    uniqueIndex('users_username_unique').on(t.username),
    check('users_disabled_bool', bool(t.disabled)),
    check('users_is_admin_bool', bool(t.isAdmin)),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, restrict),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

// Password recovery code (docs/phase2-login.md, "Recovery code"). The database decides validity, never the file: only
// the SHA-256 of the code is stored, and a row with ended_at set never validates again. At most one active row.
export const recoveryCodes = sqliteTable(
  'recovery_codes',
  {
    id: integer('id').primaryKey(),
    codeHash: text('code_hash').notNull(),
    createdAt: text('created_at').notNull(),
    endedAt: text('ended_at'),
    endReason: text('end_reason'),
    usedBy: integer('used_by').references(() => users.id, restrict),
  },
  (t) => [
    uniqueIndex('recovery_codes_hash_unique').on(t.codeHash),
    uniqueIndex('recovery_codes_one_active').on(sql`(${t.endedAt} IS NULL)`).where(sql`${t.endedAt} IS NULL`),
    check('recovery_codes_hash', sql`length(${t.codeHash}) = 64`),
    check('recovery_codes_end_reason', oneOf(t.endReason, ['used', 'rotated', 'revoked'], true)),
    check('recovery_codes_ended', sql`(${t.endedAt} IS NULL) = (${t.endReason} IS NULL)`),
    check('recovery_codes_used_by', sql`(${t.endReason} IS 'used') = (${t.usedBy} IS NOT NULL)`),
  ],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey(),
    at: text('at').notNull(),
    userId: integer('user_id').references(() => users.id, restrict),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityIds: text('entity_ids').notNull(),
    outcome: text('outcome').notNull(),
    detail: text('detail').notNull().default('{}'),
  },
  (t) => [
    index('audit_log_at_idx').on(t.at),
    index('audit_log_entity_at_idx').on(t.entity, t.at),
    check('audit_log_outcome', oneOf(t.outcome, ['ok', 'failed', 'refused'])),
    check('audit_log_entity_ids_json', json(t.entityIds)),
    check('audit_log_detail_json', sql`json_valid(${t.detail}) AND json_type(${t.detail}) = 'object'`),
  ],
);

export const workerLease = sqliteTable(
  'worker_lease',
  {
    id: integer('id').primaryKey(),
    holder: text('holder').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [check('worker_lease_single_row', sql`${t.id} = 1`)],
);

export const backupRuns = sqliteTable(
  'backup_runs',
  {
    id: integer('id').primaryKey(),
    at: text('at').notNull(),
    kind: text('kind').notNull(),
    drive: text('drive'),
    snapshotId: text('snapshot_id'),
    outcome: text('outcome').notNull(),
    error: text('error'),
  },
  (t) => [
    index('backup_runs_kind_at_idx').on(t.kind, t.at),
    check('backup_runs_kind', oneOf(t.kind, ['local', 'off_machine', 'restore_drill', 'pre_migration'])),
    check('backup_runs_drive', oneOf(t.drive, ['A', 'B'], true)),
    check('backup_runs_outcome', oneOf(t.outcome, ['ok', 'failed'])),
  ],
);

/** The 18 approved tables, in the order of docs/phase1-schema.md, then the tables added later. */
export const ALL_TABLES = [
  parcels, imports, importReviewItems, parcelScanEvents, detectedFiles, parcelPhoneChanges,
  sendBatches, notifications, notificationParcels, smsAttempts, contactAttempts, contactAttemptParcels,
  settings, users, sessions, auditLog, workerLease, backupRuns,
  recoveryCodes,
] as const;
