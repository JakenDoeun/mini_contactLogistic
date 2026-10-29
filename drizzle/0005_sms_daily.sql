-- v0.2.1 (owner, 2026-10-29): SMS sent and failed per Cambodia day and SIM for the Dashboard; counts only, kept after retention.
CREATE TABLE `sms_daily` (
	`day` text NOT NULL,
	`sim` integer NOT NULL,
	`sms` integer NOT NULL,
	`parts` integer NOT NULL,
	`failed` integer NOT NULL,
	PRIMARY KEY(`day`, `sim`),
	CONSTRAINT "sms_daily_day" CHECK("sms_daily"."day" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "sms_daily_sim" CHECK("sms_daily"."sim" BETWEEN 0 AND 8)
);