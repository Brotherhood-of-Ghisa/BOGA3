CREATE TABLE `session_plan_exercises` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`session_plan_id` text NOT NULL,
	`exercise_definition_id` text,
	`order_index` integer NOT NULL,
	`name` text NOT NULL,
	`machine_name` text,
	`progress_status` text DEFAULT 'pending' NOT NULL,
	`resolved_at` integer,
	`deleted_at` integer,
	`local_dirty` integer DEFAULT false NOT NULL,
	`local_updated_at_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_plan_id`) REFERENCES `session_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_definition_id`) REFERENCES `exercise_definitions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "session_plan_exercises_order_index_non_negative" CHECK("session_plan_exercises"."order_index" >= 0),
	CONSTRAINT "session_plan_exercises_progress_status_valid" CHECK("session_plan_exercises"."progress_status" in ('pending', 'completed', 'skipped')),
	CONSTRAINT "session_plan_exercises_resolved_at_valid" CHECK("session_plan_exercises"."resolved_at" is null or "session_plan_exercises"."progress_status" in ('completed', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX `session_plan_exercises_session_plan_id_idx` ON `session_plan_exercises` (`session_plan_id`);--> statement-breakpoint
CREATE INDEX `session_plan_exercises_exercise_definition_id_idx` ON `session_plan_exercises` (`exercise_definition_id`);--> statement-breakpoint
CREATE INDEX `session_plan_exercises_deleted_at_idx` ON `session_plan_exercises` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_plan_exercises_plan_id_order_index_unique` ON `session_plan_exercises` (`session_plan_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `session_plan_sets` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`session_plan_exercise_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`target_weight_value` text,
	`target_reps` integer NOT NULL,
	`target_set_type` text,
	`deleted_at` integer,
	`local_dirty` integer DEFAULT false NOT NULL,
	`local_updated_at_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_plan_exercise_id`) REFERENCES `session_plan_exercises`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "session_plan_sets_order_index_non_negative" CHECK("session_plan_sets"."order_index" >= 0),
	CONSTRAINT "session_plan_sets_target_reps_positive" CHECK("session_plan_sets"."target_reps" > 0)
);
--> statement-breakpoint
CREATE INDEX `session_plan_sets_session_plan_exercise_id_idx` ON `session_plan_sets` (`session_plan_exercise_id`);--> statement-breakpoint
CREATE INDEX `session_plan_sets_deleted_at_idx` ON `session_plan_sets` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_plan_sets_plan_exercise_id_order_index_unique` ON `session_plan_sets` (`session_plan_exercise_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `session_plans` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`programme_id` text,
	`programme_order_index` integer,
	`gym_id` text,
	`title` text NOT NULL,
	`scheduled_for` integer,
	`provenance` text DEFAULT 'human' NOT NULL,
	`deleted_at` integer,
	`local_dirty` integer DEFAULT false NOT NULL,
	`local_updated_at_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`programme_id`) REFERENCES `training_programmes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`gym_id`) REFERENCES `gyms`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "session_plans_title_non_empty" CHECK(length("session_plans"."title") > 0),
	CONSTRAINT "session_plans_provenance_valid" CHECK("session_plans"."provenance" in ('human', 'agent')),
	CONSTRAINT "session_plans_programme_order_index_non_negative" CHECK("session_plans"."programme_order_index" is null or "session_plans"."programme_order_index" >= 0)
);
--> statement-breakpoint
CREATE INDEX `session_plans_programme_id_idx` ON `session_plans` (`programme_id`);--> statement-breakpoint
CREATE INDEX `session_plans_gym_id_idx` ON `session_plans` (`gym_id`);--> statement-breakpoint
CREATE INDEX `session_plans_scheduled_for_idx` ON `session_plans` (`scheduled_for`);--> statement-breakpoint
CREATE INDEX `session_plans_deleted_at_idx` ON `session_plans` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `training_programmes` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`deleted_at` integer,
	`local_dirty` integer DEFAULT false NOT NULL,
	`local_updated_at_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "training_programmes_name_non_empty" CHECK(length("training_programmes"."name") > 0)
);
--> statement-breakpoint
CREATE INDEX `training_programmes_deleted_at_idx` ON `training_programmes` (`deleted_at`);--> statement-breakpoint
ALTER TABLE `exercise_sets` ADD `source_plan_set_id` text REFERENCES session_plan_sets(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `exercise_sets_source_plan_set_id_idx` ON `exercise_sets` (`source_plan_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_sets_owner_source_set_unique` ON `exercise_sets` (`source_plan_set_id`) WHERE "exercise_sets"."deleted_at" is null and "exercise_sets"."source_plan_set_id" is not null;--> statement-breakpoint
ALTER TABLE `session_exercises` ADD `source_plan_exercise_id` text REFERENCES session_plan_exercises(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `session_exercises_source_plan_exercise_id_idx` ON `session_exercises` (`source_plan_exercise_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_exercises_owner_source_block_unique` ON `session_exercises` (`source_plan_exercise_id`) WHERE "session_exercises"."deleted_at" is null and "session_exercises"."source_plan_exercise_id" is not null;--> statement-breakpoint
ALTER TABLE `sessions` ADD `source_plan_id` text REFERENCES session_plans(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `sessions_source_plan_id_idx` ON `sessions` (`source_plan_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_owner_source_plan_unique` ON `sessions` (`source_plan_id`) WHERE "sessions"."deleted_at" is null and "sessions"."source_plan_id" is not null;