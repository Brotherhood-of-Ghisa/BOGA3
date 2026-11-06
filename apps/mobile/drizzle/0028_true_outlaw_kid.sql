CREATE TABLE `session_plan_uses` (
	`id` text PRIMARY KEY NOT NULL,
	`session_plan_id` text NOT NULL,
	`slot_index` integer NOT NULL,
	`kind` text NOT NULL,
	`skipped_at` integer,
	`deleted_at` integer,
	`local_dirty` integer DEFAULT false NOT NULL,
	`local_updated_at_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_plan_id`) REFERENCES `session_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "session_plan_uses_slot_positive" CHECK("session_plan_uses"."slot_index" > 0),
	CONSTRAINT "session_plan_uses_kind_valid" CHECK("session_plan_uses"."kind" in ('workout', 'skip')),
	CONSTRAINT "session_plan_uses_skip_date" CHECK("session_plan_uses"."kind" = 'skip' or "session_plan_uses"."skipped_at" is null)
);
--> statement-breakpoint
CREATE INDEX `session_plan_uses_session_plan_id_idx` ON `session_plan_uses` (`session_plan_id`);--> statement-breakpoint
CREATE INDEX `session_plan_uses_deleted_at_idx` ON `session_plan_uses` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_plan_uses_owner_slot_unique` ON `session_plan_uses` (`session_plan_id`,`slot_index`) WHERE "session_plan_uses"."deleted_at" is null;--> statement-breakpoint
DROP INDEX `exercise_sets_owner_source_set_unique`;--> statement-breakpoint
ALTER TABLE `exercise_sets` ADD `source_plan_use_id` text REFERENCES session_plan_uses(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_sets_owner_use_set_unique` ON `exercise_sets` (`source_plan_use_id`,`source_plan_set_id`) WHERE "exercise_sets"."deleted_at" is null and "exercise_sets"."source_plan_use_id" is not null and "exercise_sets"."source_plan_set_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_sets_owner_source_set_unique` ON `exercise_sets` (`source_plan_set_id`) WHERE "exercise_sets"."deleted_at" is null and "exercise_sets"."source_plan_set_id" is not null and "exercise_sets"."source_plan_use_id" is null;--> statement-breakpoint
DROP INDEX `session_exercises_owner_source_block_unique`;--> statement-breakpoint
ALTER TABLE `session_exercises` ADD `source_plan_use_id` text REFERENCES session_plan_uses(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `session_exercises_owner_use_block_unique` ON `session_exercises` (`source_plan_use_id`,`source_plan_exercise_id`) WHERE "session_exercises"."deleted_at" is null and "session_exercises"."source_plan_use_id" is not null and "session_exercises"."source_plan_exercise_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `session_exercises_owner_source_block_unique` ON `session_exercises` (`source_plan_exercise_id`) WHERE "session_exercises"."deleted_at" is null and "session_exercises"."source_plan_exercise_id" is not null and "session_exercises"."source_plan_use_id" is null;--> statement-breakpoint
DROP INDEX `sessions_owner_source_plan_unique`;--> statement-breakpoint
ALTER TABLE `sessions` ADD `source_plan_use_id` text REFERENCES session_plan_uses(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_owner_source_use_unique` ON `sessions` (`source_plan_use_id`) WHERE "sessions"."deleted_at" is null and "sessions"."source_plan_use_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_owner_source_plan_unique` ON `sessions` (`source_plan_id`) WHERE "sessions"."deleted_at" is null and "sessions"."source_plan_id" is not null and "sessions"."source_plan_use_id" is null;--> statement-breakpoint
ALTER TABLE `session_plans` ADD `is_routine` integer NOT NULL DEFAULT 0 CONSTRAINT session_plans_routine_standalone CHECK(is_routine = 0 OR programme_id IS NULL);
--> statement-breakpoint
UPDATE sync_runtime_state SET pull_cursor = '{}';
