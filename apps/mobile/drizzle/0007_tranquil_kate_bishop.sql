CREATE TABLE `body_weight_measurements` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`weight_value` text NOT NULL,
	`weight_unit` text NOT NULL,
	`weight_kg` real NOT NULL,
	`measured_at` integer NOT NULL,
	`deleted_at` integer,
	`local_dirty` integer DEFAULT false NOT NULL,
	`local_updated_at_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_weight_measurements_measured_at_idx` ON `body_weight_measurements` (`measured_at`);--> statement-breakpoint
CREATE INDEX `body_weight_measurements_deleted_at_idx` ON `body_weight_measurements` (`deleted_at`);--> statement-breakpoint
ALTER TABLE `exercise_definitions` ADD `bodyweight_coefficient` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `exercise_definitions` ADD `movement_standard` text;--> statement-breakpoint
ALTER TABLE `exercise_definitions` ADD `loading_method` text;--> statement-breakpoint
ALTER TABLE `exercise_sets` ADD `weight_unit` text DEFAULT 'kg' NOT NULL;--> statement-breakpoint
ALTER TABLE `exercise_sets` ADD `external_load_mode` text;--> statement-breakpoint
ALTER TABLE `exercise_sets` ADD `planned_weight_unit` text;--> statement-breakpoint
ALTER TABLE `exercise_sets` ADD `planned_external_load_mode` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `body_weight_kg` real;--> statement-breakpoint
ALTER TABLE `sessions` ADD `body_weight_source` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `body_weight_measurement_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `body_weight_measured_at` integer;