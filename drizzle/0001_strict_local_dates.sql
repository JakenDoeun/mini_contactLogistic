-- Strict local dates (owner decision on review finding I2, 2026-10-14): a local date must be a real calendar date.
-- The GLOB CHECK from 0000 accepts e.g. 2026-02-30 or 2026-19-39; SQLite cannot alter a CHECK without rebuilding the
-- table, so the rule is enforced by triggers: date(x) returns x unchanged only for a real YYYY-MM-DD.
-- parcel_scan_events.scan_date is already strict (its CHECK ties it to a real, canonical scan_time_raw).
-- Existing rows are checked first: any impossible date fails this migration and rolls it back.
CREATE TEMP TABLE `_strict_local_dates` (`d` text CHECK (`d` IS NULL OR date(`d`) IS `d`));
--> statement-breakpoint
INSERT INTO `_strict_local_dates` (`d`)
  SELECT `arrival_date` FROM `parcels`
  UNION ALL SELECT `chosen_scan_date` FROM `imports`
  UNION ALL SELECT `arrival_batch_date` FROM `imports`
  UNION ALL SELECT `parcel_scan_date` FROM `import_review_items`
  UNION ALL SELECT `arrival_date` FROM `send_batches`
  UNION ALL SELECT `arrival_date` FROM `notifications`;
--> statement-breakpoint
DROP TABLE `_strict_local_dates`;
--> statement-breakpoint
CREATE TRIGGER `parcels_arrival_date_real_insert` BEFORE INSERT ON `parcels`
WHEN date(NEW.`arrival_date`) IS NOT NEW.`arrival_date`
BEGIN SELECT RAISE(ABORT, 'parcels: arrival_date is not a real calendar date'); END;
--> statement-breakpoint
CREATE TRIGGER `parcels_arrival_date_real_update` BEFORE UPDATE OF `arrival_date` ON `parcels`
WHEN date(NEW.`arrival_date`) IS NOT NEW.`arrival_date`
BEGIN SELECT RAISE(ABORT, 'parcels: arrival_date is not a real calendar date'); END;
--> statement-breakpoint
CREATE TRIGGER `imports_dates_real_insert` BEFORE INSERT ON `imports`
WHEN (NEW.`chosen_scan_date` IS NOT NULL AND date(NEW.`chosen_scan_date`) IS NOT NEW.`chosen_scan_date`)
  OR (NEW.`arrival_batch_date` IS NOT NULL AND date(NEW.`arrival_batch_date`) IS NOT NEW.`arrival_batch_date`)
BEGIN SELECT RAISE(ABORT, 'imports: chosen_scan_date or arrival_batch_date is not a real calendar date'); END;
--> statement-breakpoint
CREATE TRIGGER `imports_dates_real_update` BEFORE UPDATE OF `chosen_scan_date`, `arrival_batch_date` ON `imports`
WHEN (NEW.`chosen_scan_date` IS NOT NULL AND date(NEW.`chosen_scan_date`) IS NOT NEW.`chosen_scan_date`)
  OR (NEW.`arrival_batch_date` IS NOT NULL AND date(NEW.`arrival_batch_date`) IS NOT NEW.`arrival_batch_date`)
BEGIN SELECT RAISE(ABORT, 'imports: chosen_scan_date or arrival_batch_date is not a real calendar date'); END;
--> statement-breakpoint
CREATE TRIGGER `review_items_scan_date_real_insert` BEFORE INSERT ON `import_review_items`
WHEN NEW.`parcel_scan_date` IS NOT NULL AND date(NEW.`parcel_scan_date`) IS NOT NEW.`parcel_scan_date`
BEGIN SELECT RAISE(ABORT, 'import_review_items: parcel_scan_date is not a real calendar date'); END;
--> statement-breakpoint
CREATE TRIGGER `send_batches_arrival_date_real_insert` BEFORE INSERT ON `send_batches`
WHEN date(NEW.`arrival_date`) IS NOT NEW.`arrival_date`
BEGIN SELECT RAISE(ABORT, 'send_batches: arrival_date is not a real calendar date'); END;
--> statement-breakpoint
CREATE TRIGGER `send_batches_arrival_date_real_update` BEFORE UPDATE OF `arrival_date` ON `send_batches`
WHEN date(NEW.`arrival_date`) IS NOT NEW.`arrival_date`
BEGIN SELECT RAISE(ABORT, 'send_batches: arrival_date is not a real calendar date'); END;
--> statement-breakpoint
CREATE TRIGGER `notifications_arrival_date_real_insert` BEFORE INSERT ON `notifications`
WHEN date(NEW.`arrival_date`) IS NOT NEW.`arrival_date`
BEGIN SELECT RAISE(ABORT, 'notifications: arrival_date is not a real calendar date'); END;
--> statement-breakpoint
CREATE TRIGGER `notifications_arrival_date_real_update` BEFORE UPDATE OF `arrival_date` ON `notifications`
WHEN date(NEW.`arrival_date`) IS NOT NEW.`arrival_date`
BEGIN SELECT RAISE(ABORT, 'notifications: arrival_date is not a real calendar date'); END;
