-- Phase 12 (owner, 2026-10-23): the gateway phone's SIM chosen for each SMS by the customer's carrier.
-- drizzle-kit generated a rebuild of `sms_attempts` that copies the not-yet-existing column; ADD COLUMN is used instead.
ALTER TABLE `sms_attempts` ADD COLUMN `sim_number` integer CONSTRAINT "sms_attempts_sim_number" CHECK("sim_number" IS NULL OR "sim_number" BETWEEN 1 AND 8);
