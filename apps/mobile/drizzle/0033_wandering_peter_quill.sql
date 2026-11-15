CREATE TABLE `injuries` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`muscle_group_id` text,
	`side` text,
	`status` text NOT NULL,
	`pain_score` integer,
	`label` text NOT NULL,
	`notes` text,
	`contraindications` text,
	`started_at` integer NOT NULL,
	`resolved_at` integer,
	`deleted_at` integer,
	`local_dirty` integer DEFAULT false NOT NULL,
	`local_updated_at_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`muscle_group_id`) REFERENCES `muscle_groups`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `injuries_muscle_group_id_idx` ON `injuries` (`muscle_group_id`);--> statement-breakpoint
CREATE INDEX `injuries_started_at_idx` ON `injuries` (`started_at`);--> statement-breakpoint
CREATE INDEX `injuries_deleted_at_idx` ON `injuries` (`deleted_at`);--> statement-breakpoint
-- Re-pull every layer once so existing injuries are downloaded on upgrade.
UPDATE sync_runtime_state SET pull_cursor = '{}';
