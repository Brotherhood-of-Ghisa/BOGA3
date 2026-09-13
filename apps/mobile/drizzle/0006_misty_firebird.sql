CREATE TABLE `exercise_group_links` (
	`id` text PRIMARY KEY NOT NULL,
	`exercise_definition_id` text NOT NULL,
	`group_id` text NOT NULL,
	`group_exercise_id` text NOT NULL,
	`deleted_at` integer,
	`local_dirty` integer DEFAULT false NOT NULL,
	`local_updated_at_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`exercise_definition_id`) REFERENCES `exercise_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exercise_group_links_id_deterministic" CHECK("exercise_group_links"."id" = "exercise_group_links"."group_id" || ':' || "exercise_group_links"."exercise_definition_id")
);
--> statement-breakpoint
CREATE INDEX `exercise_group_links_exercise_definition_id_idx` ON `exercise_group_links` (`exercise_definition_id`);--> statement-breakpoint
CREATE INDEX `exercise_group_links_group_exercise_id_idx` ON `exercise_group_links` (`group_exercise_id`);--> statement-breakpoint
CREATE INDEX `exercise_group_links_deleted_at_idx` ON `exercise_group_links` (`deleted_at`);