CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_ids` text NOT NULL,
	`outcome` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "audit_log_outcome" CHECK("audit_log"."outcome" IN ('ok', 'failed', 'refused')),
	CONSTRAINT "audit_log_entity_ids_json" CHECK(json_valid("audit_log"."entity_ids")),
	CONSTRAINT "audit_log_detail_json" CHECK(json_valid("audit_log"."detail") AND json_type("audit_log"."detail") = 'object')
);
--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_log_entity_at_idx` ON `audit_log` (`entity`,`at`);--> statement-breakpoint
CREATE TABLE `backup_runs` (
	`id` integer PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`drive` text,
	`snapshot_id` text,
	`outcome` text NOT NULL,
	`error` text,
	CONSTRAINT "backup_runs_kind" CHECK("backup_runs"."kind" IN ('local', 'off_machine', 'restore_drill', 'pre_migration')),
	CONSTRAINT "backup_runs_drive" CHECK("backup_runs"."drive" IS NULL OR "backup_runs"."drive" IN ('A', 'B')),
	CONSTRAINT "backup_runs_outcome" CHECK("backup_runs"."outcome" IN ('ok', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `backup_runs_kind_at_idx` ON `backup_runs` (`kind`,`at`);--> statement-breakpoint
CREATE TABLE `contact_attempt_parcels` (
	`contact_attempt_id` integer NOT NULL,
	`parcel_id` integer NOT NULL,
	PRIMARY KEY(`contact_attempt_id`, `parcel_id`),
	FOREIGN KEY (`contact_attempt_id`) REFERENCES `contact_attempts`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`parcel_id`) REFERENCES `parcels`(`id`) ON UPDATE restrict ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `contact_attempt_parcels_parcel_idx` ON `contact_attempt_parcels` (`parcel_id`);--> statement-breakpoint
CREATE TABLE `contact_attempts` (
	`id` integer PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`outcome` text NOT NULL,
	`note` text,
	`phone_normalized` text,
	`created_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "contact_attempts_channel" CHECK("contact_attempts"."channel" IN ('call', 'telegram', 'other', 'flag')),
	CONSTRAINT "contact_attempts_outcome" CHECK("contact_attempts"."outcome" IN ('reached', 'no_answer', 'attempted', 'messaged', 'follow_up'))
);
--> statement-breakpoint
CREATE INDEX `contact_attempts_phone_idx` ON `contact_attempts` (`phone_normalized`);--> statement-breakpoint
CREATE TABLE `detected_files` (
	`id` integer PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`modified_at` text NOT NULL,
	`sha256` text,
	`state` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`import_id` integer,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "detected_files_state" CHECK("detected_files"."state" IN ('waiting', 'unreadable', 'imported', 'dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `detected_files_identity_unique` ON `detected_files` (`path`,`size_bytes`,`modified_at`);--> statement-breakpoint
CREATE INDEX `detected_files_sha256_idx` ON `detected_files` (`sha256`);--> statement-breakpoint
CREATE TABLE `import_review_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`import_id` integer NOT NULL,
	`tracking_key` text NOT NULL,
	`kind` text NOT NULL,
	`blocking` integer NOT NULL,
	`detail` text NOT NULL,
	`parcel_scan_date` text,
	`existing_parcel_id` integer,
	`resolution` text,
	`chosen` text,
	`resolved_by` integer,
	`resolved_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`existing_parcel_id`) REFERENCES `parcels`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "review_items_kind" CHECK("import_review_items"."kind" IN ('recipient_conflict', 'code_spelling', 'db_duplicate', 'not_chosen_scan_date', 'excluded_by_staff', 'unparseable_scan_time')),
	CONSTRAINT "review_items_blocking" CHECK("import_review_items"."blocking" = ("import_review_items"."kind" IN ('recipient_conflict', 'code_spelling'))),
	CONSTRAINT "review_items_detail_json" CHECK(json_valid("import_review_items"."detail")),
	CONSTRAINT "review_items_chosen_json" CHECK("import_review_items"."chosen" IS NULL OR json_valid("import_review_items"."chosen")),
	CONSTRAINT "review_items_resolution" CHECK("import_review_items"."resolution" IS NULL OR "import_review_items"."resolution" IN ('chosen', 'left_out')),
	CONSTRAINT "review_items_resolved_at" CHECK("import_review_items"."resolution" IS NULL OR "import_review_items"."resolved_at" IS NOT NULL),
	CONSTRAINT "review_items_chosen_present" CHECK(coalesce("import_review_items"."resolution", '') <> 'chosen' OR "import_review_items"."chosen" IS NOT NULL),
	CONSTRAINT "review_items_scan_date" CHECK("import_review_items"."parcel_scan_date" IS NULL OR "import_review_items"."parcel_scan_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_items_import_key_kind_unique` ON `import_review_items` (`import_id`,`tracking_key`,`kind`);--> statement-breakpoint
CREATE INDEX `review_items_open_idx` ON `import_review_items` (`import_id`,`blocking`,`resolution`);--> statement-breakpoint
CREATE INDEX `review_items_key_idx` ON `import_review_items` (`tracking_key`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` integer PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`detected_file_id` integer,
	`original_filename` text NOT NULL,
	`stored_path` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`file_format` text,
	`status` text NOT NULL,
	`rerun_of_import_id` integer,
	`rules` text NOT NULL,
	`headers_found` text NOT NULL,
	`time_zone_assumed` text DEFAULT 'Asia/Phnom_Penh' NOT NULL,
	`scan_dates` text NOT NULL,
	`date_choice` text,
	`chosen_scan_date` text,
	`arrival_batch_date` text,
	`arrival_date_changed` integer DEFAULT 0 NOT NULL,
	`rows_total` integer NOT NULL,
	`rows_shopee` integer NOT NULL,
	`rows_excluded` integer NOT NULL,
	`excluded_codes` integer NOT NULL,
	`rows_collapsed` integer NOT NULL,
	`parcels_unique` integer NOT NULL,
	`db_duplicates` integer NOT NULL,
	`left_out` integer NOT NULL,
	`blocked` integer NOT NULL,
	`ready` integer NOT NULL,
	`parcels_added` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_detail` text,
	`checked_at` text NOT NULL,
	`checked_by` integer,
	`confirmed_at` text,
	`confirmed_by` integer,
	FOREIGN KEY (`detected_file_id`) REFERENCES `detected_files`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`rerun_of_import_id`) REFERENCES `imports`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`checked_by`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "imports_source" CHECK("imports"."source" IN ('manual', 'folder', 'seed')),
	CONSTRAINT "imports_file_format" CHECK("imports"."file_format" IS NULL OR "imports"."file_format" IN ('xlsx', 'xls', 'csv')),
	CONSTRAINT "imports_status" CHECK("imports"."status" IN ('checked', 'imported', 'no_eligible_rows', 'failed', 'cancelled')),
	CONSTRAINT "imports_rules_json" CHECK(json_valid("imports"."rules")),
	CONSTRAINT "imports_headers_json" CHECK(json_valid("imports"."headers_found")),
	CONSTRAINT "imports_scan_dates_json" CHECK(json_valid("imports"."scan_dates")),
	CONSTRAINT "imports_date_choice" CHECK("imports"."date_choice" IS NULL OR "imports"."date_choice" IN ('single_scan_date', 'all_on_batch_date', 'only_scan_date')),
	CONSTRAINT "imports_chosen_scan_date" CHECK((coalesce("imports"."date_choice", '') = 'only_scan_date') = ("imports"."chosen_scan_date" IS NOT NULL) AND ("imports"."chosen_scan_date" IS NULL OR "imports"."chosen_scan_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')),
	CONSTRAINT "imports_arrival_batch_date" CHECK("imports"."arrival_batch_date" IS NULL OR "imports"."arrival_batch_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "imports_arrival_date_changed_bool" CHECK("imports"."arrival_date_changed" IN (0, 1)),
	CONSTRAINT "imports_counts_non_negative" CHECK("imports"."size_bytes" >= 0 AND "imports"."rows_total" >= 0 AND "imports"."rows_shopee" >= 0 AND "imports"."rows_excluded" >= 0 AND "imports"."excluded_codes" >= 0 AND "imports"."rows_collapsed" >= 0 AND "imports"."parcels_unique" >= 0 AND "imports"."db_duplicates" >= 0 AND "imports"."left_out" >= 0 AND "imports"."blocked" >= 0 AND "imports"."ready" >= 0 AND "imports"."parcels_added" >= 0),
	CONSTRAINT "imports_rows_identity" CHECK("imports"."rows_total" = "imports"."rows_shopee" + "imports"."rows_excluded"),
	CONSTRAINT "imports_collapsed_identity" CHECK("imports"."rows_collapsed" = "imports"."rows_shopee" - "imports"."parcels_unique"),
	CONSTRAINT "imports_parcels_identity" CHECK("imports"."parcels_unique" = "imports"."db_duplicates" + "imports"."left_out" + "imports"."blocked" + "imports"."ready"),
	CONSTRAINT "imports_status_rules" CHECK(CASE "imports"."status"
        WHEN 'imported' THEN "imports"."confirmed_at" IS NOT NULL AND "imports"."arrival_batch_date" IS NOT NULL AND "imports"."date_choice" IS NOT NULL AND "imports"."parcels_added" = "imports"."ready" AND "imports"."blocked" = 0
        WHEN 'failed' THEN "imports"."confirmed_at" IS NULL AND "imports"."parcels_added" = 0 AND "imports"."error_code" IS NOT NULL
        ELSE "imports"."confirmed_at" IS NULL AND "imports"."parcels_added" = 0
      END)
);
--> statement-breakpoint
CREATE INDEX `imports_sha256_idx` ON `imports` (`sha256`);--> statement-breakpoint
CREATE INDEX `imports_status_idx` ON `imports` (`status`);--> statement-breakpoint
CREATE INDEX `imports_rerun_idx` ON `imports` (`rerun_of_import_id`);--> statement-breakpoint
CREATE TABLE `notification_parcels` (
	`notification_id` integer NOT NULL,
	`parcel_id` integer NOT NULL,
	PRIMARY KEY(`notification_id`, `parcel_id`),
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`parcel_id`) REFERENCES `parcels`(`id`) ON UPDATE restrict ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `notification_parcels_parcel_idx` ON `notification_parcels` (`parcel_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY NOT NULL,
	`phone_normalized` text NOT NULL,
	`arrival_date` text NOT NULL,
	`message_text` text NOT NULL,
	`reason` text NOT NULL,
	`batch_id` integer,
	`created_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `send_batches`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "notifications_reason" CHECK("notifications"."reason" IN ('initial', 'resend')),
	CONSTRAINT "notifications_arrival_date" CHECK("notifications"."arrival_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE INDEX `notifications_phone_idx` ON `notifications` (`phone_normalized`);--> statement-breakpoint
CREATE INDEX `notifications_arrival_phone_idx` ON `notifications` (`arrival_date`,`phone_normalized`);--> statement-breakpoint
CREATE TABLE `parcel_phone_changes` (
	`id` integer PRIMARY KEY NOT NULL,
	`parcel_id` integer NOT NULL,
	`old_raw` text,
	`new_raw` text,
	`old_normalized` text,
	`new_normalized` text,
	`changed_by` integer,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`parcel_id`) REFERENCES `parcels`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `phone_changes_parcel_idx` ON `parcel_phone_changes` (`parcel_id`);--> statement-breakpoint
CREATE TABLE `parcel_scan_events` (
	`id` integer PRIMARY KEY NOT NULL,
	`parcel_id` integer NOT NULL,
	`import_id` integer NOT NULL,
	`source_row` integer NOT NULL,
	`tracking_code_raw` text NOT NULL,
	`scan_type_raw` text,
	`scan_time_raw` text,
	`scan_time_utc` text,
	`scan_date` text,
	`scan_site_raw` text,
	`upload_time_raw` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`parcel_id`) REFERENCES `parcels`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "scan_events_source_row" CHECK("parcel_scan_events"."source_row" > 0),
	CONSTRAINT "scan_events_parsed_pair" CHECK(("parcel_scan_events"."scan_time_utc" IS NULL) = ("parcel_scan_events"."scan_date" IS NULL)),
	CONSTRAINT "scan_events_parsed_matches_raw" CHECK("parcel_scan_events"."scan_time_utc" IS NULL OR (
        "parcel_scan_events"."scan_time_raw" IS NOT NULL
        AND strftime('%Y-%m-%d %H:%M:%S', "parcel_scan_events"."scan_time_raw") IS "parcel_scan_events"."scan_time_raw"
        AND "parcel_scan_events"."scan_time_utc" IS strftime('%Y-%m-%dT%H:%M:%fZ', "parcel_scan_events"."scan_time_raw", '-7 hours')
        AND "parcel_scan_events"."scan_date" IS substr("parcel_scan_events"."scan_time_raw", 1, 10)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_events_import_row_unique` ON `parcel_scan_events` (`import_id`,`source_row`);--> statement-breakpoint
CREATE INDEX `scan_events_parcel_idx` ON `parcel_scan_events` (`parcel_id`);--> statement-breakpoint
CREATE TABLE `parcels` (
	`id` integer PRIMARY KEY NOT NULL,
	`tracking_code` text NOT NULL,
	`tracking_key` text NOT NULL,
	`recipient_name` text NOT NULL,
	`import_phone_raw` text,
	`phone_raw` text,
	`phone_normalized` text,
	`phone_edited` integer DEFAULT 0 NOT NULL,
	`arrival_date` text NOT NULL,
	`first_import_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`first_import_id`) REFERENCES `imports`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "parcels_tracking_code_nonempty" CHECK(length("parcels"."tracking_code") > 0 AND "parcels"."tracking_code" = trim("parcels"."tracking_code")),
	CONSTRAINT "parcels_tracking_key_rule" CHECK("parcels"."tracking_key" = upper("parcels"."tracking_code")),
	CONSTRAINT "parcels_phone_edited_bool" CHECK("parcels"."phone_edited" IN (0, 1)),
	CONSTRAINT "parcels_phone_unedited" CHECK("parcels"."phone_edited" = 1 OR "parcels"."phone_raw" IS "parcels"."import_phone_raw"),
	CONSTRAINT "parcels_arrival_date" CHECK("parcels"."arrival_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parcels_tracking_key_unique` ON `parcels` (`tracking_key`);--> statement-breakpoint
CREATE INDEX `parcels_arrival_phone_idx` ON `parcels` (`arrival_date`,`phone_normalized`);--> statement-breakpoint
CREATE INDEX `parcels_phone_idx` ON `parcels` (`phone_normalized`);--> statement-breakpoint
CREATE INDEX `parcels_recipient_idx` ON `parcels` (`recipient_name`);--> statement-breakpoint
CREATE TABLE `send_batches` (
	`id` integer PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`arrival_date` text NOT NULL,
	`planned_messages` integer NOT NULL,
	`planned_parcels` integer NOT NULL,
	`status` text NOT NULL,
	`created_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "send_batches_status" CHECK("send_batches"."status" IN ('running', 'paused', 'stopped', 'done')),
	CONSTRAINT "send_batches_arrival_date" CHECK("send_batches"."arrival_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "send_batches_counts" CHECK("send_batches"."planned_messages" >= 0 AND "send_batches"."planned_parcels" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `send_batches_request_key_unique` ON `send_batches` (`request_key`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "settings_value_json" CHECK(json_valid("settings"."value"))
);
--> statement-breakpoint
CREATE TABLE `sms_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` integer NOT NULL,
	`attempt_no` integer NOT NULL,
	`state` text NOT NULL,
	`gateway_state` text,
	`error_code` text,
	`error_detail` text,
	`queued_at` text NOT NULL,
	`submitted_at` text,
	`sent_at` text,
	`delivered_at` text,
	`failed_at` text,
	`last_checked_at` text,
	`resolved_by` integer,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "sms_attempts_state" CHECK("sms_attempts"."state" IN ('queued', 'submitting', 'submitted', 'sent', 'delivered', 'failed', 'unconfirmed', 'cancelled')),
	CONSTRAINT "sms_attempts_attempt_no" CHECK("sms_attempts"."attempt_no" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sms_attempts_notification_attempt_unique` ON `sms_attempts` (`notification_id`,`attempt_no`);--> statement-breakpoint
CREATE INDEX `sms_attempts_state_idx` ON `sms_attempts` (`state`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "users_disabled_bool" CHECK("users"."disabled" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `worker_lease` (
	`id` integer PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "worker_lease_single_row" CHECK("worker_lease"."id" = 1)
);
--> statement-breakpoint
-- Hand-written triggers (docs/phase1-schema.md): Drizzle Kit cannot generate these.
-- Append-only tables: no DELETE.
CREATE TRIGGER `parcel_phone_changes_no_delete` BEFORE DELETE ON `parcel_phone_changes` BEGIN SELECT RAISE(ABORT, 'parcel_phone_changes is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `parcel_scan_events_no_delete` BEFORE DELETE ON `parcel_scan_events` BEGIN SELECT RAISE(ABORT, 'parcel_scan_events is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `import_review_items_no_delete` BEFORE DELETE ON `import_review_items` BEGIN SELECT RAISE(ABORT, 'import_review_items is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `notifications_no_delete` BEFORE DELETE ON `notifications` BEGIN SELECT RAISE(ABORT, 'notifications is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `notification_parcels_no_delete` BEFORE DELETE ON `notification_parcels` BEGIN SELECT RAISE(ABORT, 'notification_parcels is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `contact_attempts_no_delete` BEFORE DELETE ON `contact_attempts` BEGIN SELECT RAISE(ABORT, 'contact_attempts is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `contact_attempt_parcels_no_delete` BEFORE DELETE ON `contact_attempt_parcels` BEGIN SELECT RAISE(ABORT, 'contact_attempt_parcels is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_delete` BEFORE DELETE ON `audit_log` BEGIN SELECT RAISE(ABORT, 'audit_log is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `backup_runs_no_delete` BEFORE DELETE ON `backup_runs` BEGIN SELECT RAISE(ABORT, 'backup_runs is append-only: rows cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `parcel_phone_changes_no_update` BEFORE UPDATE ON `parcel_phone_changes` BEGIN SELECT RAISE(ABORT, 'parcel_phone_changes is append-only: rows cannot be changed'); END;
--> statement-breakpoint
CREATE TRIGGER `parcel_scan_events_no_update` BEFORE UPDATE ON `parcel_scan_events` BEGIN SELECT RAISE(ABORT, 'parcel_scan_events is append-only: rows cannot be changed'); END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_update` BEFORE UPDATE ON `audit_log` BEGIN SELECT RAISE(ABORT, 'audit_log is append-only: rows cannot be changed'); END;
--> statement-breakpoint
CREATE TRIGGER `imports_status_change` BEFORE UPDATE OF `status` ON `imports`
WHEN OLD.`status` <> NEW.`status` AND NOT (OLD.`status` = 'checked' AND NEW.`status` IN ('imported', 'failed', 'cancelled'))
BEGIN SELECT RAISE(ABORT, 'imports: only checked -> imported, failed or cancelled is allowed'); END;
--> statement-breakpoint
CREATE TRIGGER `review_items_insert_while_checked` BEFORE INSERT ON `import_review_items`
WHEN (SELECT `status` FROM `imports` WHERE `id` = NEW.`import_id`) IS NOT 'checked'
BEGIN SELECT RAISE(ABORT, 'import_review_items: the import is no longer being reviewed'); END;
--> statement-breakpoint
CREATE TRIGGER `review_items_update_while_checked` BEFORE UPDATE ON `import_review_items`
WHEN (SELECT `status` FROM `imports` WHERE `id` = OLD.`import_id`) IS NOT 'checked'
BEGIN SELECT RAISE(ABORT, 'import_review_items: read-only once the import is no longer being reviewed'); END;
--> statement-breakpoint
CREATE TRIGGER `review_items_evidence_fixed` BEFORE UPDATE ON `import_review_items`
WHEN NEW.`import_id` IS NOT OLD.`import_id` OR NEW.`tracking_key` IS NOT OLD.`tracking_key` OR NEW.`kind` IS NOT OLD.`kind`
  OR NEW.`blocking` IS NOT OLD.`blocking` OR NEW.`detail` IS NOT OLD.`detail` OR NEW.`parcel_scan_date` IS NOT OLD.`parcel_scan_date`
  OR NEW.`existing_parcel_id` IS NOT OLD.`existing_parcel_id` OR NEW.`created_at` IS NOT OLD.`created_at`
BEGIN SELECT RAISE(ABORT, 'import_review_items: only the resolution can change'); END;
--> statement-breakpoint
CREATE TRIGGER `parcels_import_phone_fixed` BEFORE UPDATE OF `import_phone_raw` ON `parcels`
WHEN NEW.`import_phone_raw` IS NOT OLD.`import_phone_raw`
BEGIN SELECT RAISE(ABORT, 'parcels: import_phone_raw never changes'); END;
--> statement-breakpoint
CREATE TRIGGER `parcels_phone_edited_kept` BEFORE UPDATE OF `phone_edited` ON `parcels`
WHEN OLD.`phone_edited` = 1 AND NEW.`phone_edited` <> 1
BEGIN SELECT RAISE(ABORT, 'parcels: phone_edited is never reset'); END;
