CREATE TABLE `training_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`exercise_definition_id` text,
	`body` text NOT NULL,
	`noted_on` text NOT NULL,
	`source` text DEFAULT 'app' NOT NULL,
	`deleted_at` integer,
	`local_dirty` integer DEFAULT false NOT NULL,
	`local_updated_at_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`exercise_definition_id`) REFERENCES `exercise_definitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `training_notes_exercise_definition_id_idx` ON `training_notes` (`exercise_definition_id`);--> statement-breakpoint
CREATE INDEX `training_notes_deleted_at_idx` ON `training_notes` (`deleted_at`);