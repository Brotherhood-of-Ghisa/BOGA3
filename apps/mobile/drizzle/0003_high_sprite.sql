PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_exercise_definitions` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`name` text NOT NULL,
	`load_input_mode` text DEFAULT 'total_load' NOT NULL,
	`deleted_at` integer,
	`local_dirty` integer DEFAULT false NOT NULL,
	`local_updated_at_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "exercise_definitions_name_non_empty" CHECK("__new_exercise_definitions"."name" <> ''),
	CONSTRAINT "exercise_definitions_load_input_mode_valid" CHECK("__new_exercise_definitions"."load_input_mode" in ('total_load', 'per_side_load'))
);
--> statement-breakpoint
INSERT INTO `__new_exercise_definitions`("id", "name", "load_input_mode", "deleted_at", "local_dirty", "local_updated_at_ms", "created_at", "updated_at") SELECT "id", "name", 'total_load', "deleted_at", "local_dirty", "local_updated_at_ms", "created_at", "updated_at" FROM `exercise_definitions`;--> statement-breakpoint
DROP TABLE `exercise_definitions`;--> statement-breakpoint
ALTER TABLE `__new_exercise_definitions` RENAME TO `exercise_definitions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `exercise_definitions_name_idx` ON `exercise_definitions` (`name`);--> statement-breakpoint
CREATE INDEX `exercise_definitions_deleted_at_idx` ON `exercise_definitions` (`deleted_at`);
