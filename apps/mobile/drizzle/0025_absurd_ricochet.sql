CREATE TABLE `exercise_merge_local` (
	`owner_user_id` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`owner_user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `exercise_merge_local_owner_kind_idx` ON `exercise_merge_local` (`owner_user_id`,`kind`);--> statement-breakpoint
ALTER TABLE `exercise_sets` ADD `merge_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session_exercise_tags` ADD `merge_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session_exercises` ADD `merge_revision` integer DEFAULT 0 NOT NULL;