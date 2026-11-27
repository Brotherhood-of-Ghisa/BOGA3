CREATE TABLE `session_meet_links` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`meet_id` text NOT NULL,
	`deleted_at` integer,
	`local_dirty` integer DEFAULT false NOT NULL,
	`local_updated_at_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "session_meet_links_id_deterministic" CHECK("session_meet_links"."id" = "session_meet_links"."meet_id" || ':' || "session_meet_links"."session_id")
);
--> statement-breakpoint
CREATE INDEX `session_meet_links_session_id_idx` ON `session_meet_links` (`session_id`);--> statement-breakpoint
CREATE INDEX `session_meet_links_meet_id_idx` ON `session_meet_links` (`meet_id`);--> statement-breakpoint
CREATE INDEX `session_meet_links_deleted_at_idx` ON `session_meet_links` (`deleted_at`);