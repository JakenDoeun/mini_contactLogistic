-- Password recovery code (Phase 2, docs/phase2-login.md "Recovery code"): only the SHA-256 of the code is stored; at most
-- one active row (ended_at IS NULL). The retrievable code itself lives in a 0600 file in the data folder, never here.
CREATE TABLE `recovery_codes` (
	`id` integer PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`ended_at` text,
	`end_reason` text,
	`used_by` integer,
	FOREIGN KEY (`used_by`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "recovery_codes_hash" CHECK(length("recovery_codes"."code_hash") = 64),
	CONSTRAINT "recovery_codes_end_reason" CHECK("recovery_codes"."end_reason" IS NULL OR "recovery_codes"."end_reason" IN ('used', 'rotated', 'revoked')),
	CONSTRAINT "recovery_codes_ended" CHECK(("recovery_codes"."ended_at" IS NULL) = ("recovery_codes"."end_reason" IS NULL)),
	CONSTRAINT "recovery_codes_used_by" CHECK(("recovery_codes"."end_reason" IS 'used') = ("recovery_codes"."used_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_codes_hash_unique` ON `recovery_codes` (`code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_codes_one_active` ON `recovery_codes` (("ended_at" IS NULL)) WHERE "recovery_codes"."ended_at" IS NULL;