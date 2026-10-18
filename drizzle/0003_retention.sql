-- Phase 3, plan Revision 4 (2026-10-17): an admin flag for the retention setting, and deletion by the retention job only.
-- drizzle-kit generated a rebuild of `users` that copies the not-yet-existing column; ADD COLUMN is used instead.
ALTER TABLE `users` ADD COLUMN `is_admin` integer DEFAULT 0 NOT NULL CONSTRAINT "users_is_admin_bool" CHECK("is_admin" IN (0, 1));
--> statement-breakpoint
-- The first account is the admin.
UPDATE `users` SET `is_admin` = 1 WHERE `id` = (SELECT min(`id`) FROM `users`);
--> statement-breakpoint
-- Append-only tables: rows still cannot be deleted, except inside the retention job's transaction, which holds the
-- settings row `retention.purge_running` until it commits (no other connection ever sees that row).
DROP TRIGGER `parcel_phone_changes_no_delete`;
--> statement-breakpoint
CREATE TRIGGER `parcel_phone_changes_no_delete` BEFORE DELETE ON `parcel_phone_changes`
WHEN NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'retention.purge_running')
BEGIN SELECT RAISE(ABORT, 'parcel_phone_changes is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
DROP TRIGGER `parcel_scan_events_no_delete`;
--> statement-breakpoint
CREATE TRIGGER `parcel_scan_events_no_delete` BEFORE DELETE ON `parcel_scan_events`
WHEN NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'retention.purge_running')
BEGIN SELECT RAISE(ABORT, 'parcel_scan_events is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
DROP TRIGGER `import_review_items_no_delete`;
--> statement-breakpoint
CREATE TRIGGER `import_review_items_no_delete` BEFORE DELETE ON `import_review_items`
WHEN NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'retention.purge_running')
BEGIN SELECT RAISE(ABORT, 'import_review_items is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
DROP TRIGGER `notifications_no_delete`;
--> statement-breakpoint
CREATE TRIGGER `notifications_no_delete` BEFORE DELETE ON `notifications`
WHEN NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'retention.purge_running')
BEGIN SELECT RAISE(ABORT, 'notifications is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
DROP TRIGGER `notification_parcels_no_delete`;
--> statement-breakpoint
CREATE TRIGGER `notification_parcels_no_delete` BEFORE DELETE ON `notification_parcels`
WHEN NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'retention.purge_running')
BEGIN SELECT RAISE(ABORT, 'notification_parcels is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
DROP TRIGGER `contact_attempts_no_delete`;
--> statement-breakpoint
CREATE TRIGGER `contact_attempts_no_delete` BEFORE DELETE ON `contact_attempts`
WHEN NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'retention.purge_running')
BEGIN SELECT RAISE(ABORT, 'contact_attempts is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
DROP TRIGGER `contact_attempt_parcels_no_delete`;
--> statement-breakpoint
CREATE TRIGGER `contact_attempt_parcels_no_delete` BEFORE DELETE ON `contact_attempt_parcels`
WHEN NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'retention.purge_running')
BEGIN SELECT RAISE(ABORT, 'contact_attempt_parcels is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
DROP TRIGGER `audit_log_no_delete`;
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_delete` BEFORE DELETE ON `audit_log`
WHEN NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'retention.purge_running')
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
DROP TRIGGER `backup_runs_no_delete`;
--> statement-breakpoint
CREATE TRIGGER `backup_runs_no_delete` BEFORE DELETE ON `backup_runs`
WHEN NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'retention.purge_running')
BEGIN SELECT RAISE(ABORT, 'backup_runs is append-only: rows cannot be deleted'); END;
