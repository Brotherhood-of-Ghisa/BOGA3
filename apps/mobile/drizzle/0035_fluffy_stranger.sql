CREATE TEMP TABLE hold_source_links AS SELECT id, source_plan_set_id FROM exercise_sets WHERE source_plan_set_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_session_plan_sets` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`session_plan_exercise_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`target_weight_value` text,
	`recording_mode` text DEFAULT 'reps' NOT NULL,
	`target_reps` integer,
	`target_duration_sec` integer,
	`target_set_type` text,
	`last_modified_by` text DEFAULT 'human' NOT NULL,
	`deleted_at` integer,
	`local_dirty` integer DEFAULT false NOT NULL,
	`local_updated_at_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_plan_exercise_id`) REFERENCES `session_plan_exercises`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "session_plan_sets_order_index_non_negative" CHECK("__new_session_plan_sets"."order_index" >= 0),
	CONSTRAINT "session_plan_sets_target_measurement_valid" CHECK(
      ("__new_session_plan_sets"."recording_mode" = 'reps' and "__new_session_plan_sets"."target_reps" is not null and "__new_session_plan_sets"."target_reps" > 0 and "__new_session_plan_sets"."target_duration_sec" is null)
      or ("__new_session_plan_sets"."recording_mode" = 'hold' and "__new_session_plan_sets"."target_reps" is null and "__new_session_plan_sets"."target_duration_sec" is not null and "__new_session_plan_sets"."target_duration_sec" between 1 and 300 and "__new_session_plan_sets"."target_duration_sec" = cast("__new_session_plan_sets"."target_duration_sec" as integer))
    ),
	CONSTRAINT "session_plan_sets_last_modified_by_valid" CHECK("__new_session_plan_sets"."last_modified_by" in ('human', 'agent'))
);
--> statement-breakpoint
INSERT INTO `__new_session_plan_sets`("id", "session_plan_exercise_id", "order_index", "target_weight_value", "recording_mode", "target_reps", "target_duration_sec", "target_set_type", "last_modified_by", "deleted_at", "local_dirty", "local_updated_at_ms", "created_at", "updated_at") SELECT "id", "session_plan_exercise_id", "order_index", "target_weight_value", 'reps', "target_reps", NULL, "target_set_type", "last_modified_by", "deleted_at", "local_dirty", "local_updated_at_ms", "created_at", "updated_at" FROM `session_plan_sets`;--> statement-breakpoint
DROP TABLE `session_plan_sets`;--> statement-breakpoint
ALTER TABLE `__new_session_plan_sets` RENAME TO `session_plan_sets`;--> statement-breakpoint
UPDATE exercise_sets SET source_plan_set_id = (SELECT source_plan_set_id FROM hold_source_links WHERE hold_source_links.id = exercise_sets.id) WHERE id IN (SELECT id FROM hold_source_links);--> statement-breakpoint
DROP TABLE hold_source_links;--> statement-breakpoint
CREATE INDEX `session_plan_sets_session_plan_exercise_id_idx` ON `session_plan_sets` (`session_plan_exercise_id`);--> statement-breakpoint
CREATE INDEX `session_plan_sets_deleted_at_idx` ON `session_plan_sets` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_plan_sets_plan_exercise_id_order_index_unique` ON `session_plan_sets` (`session_plan_exercise_id`,`order_index`);--> statement-breakpoint
ALTER TABLE exercise_definitions ADD recording_mode text NOT NULL DEFAULT 'reps' CONSTRAINT exercise_definitions_recording_mode_valid CHECK(recording_mode IN ('reps', 'hold'));--> statement-breakpoint
ALTER TABLE exercise_sets ADD recording_mode text NOT NULL DEFAULT 'reps' CONSTRAINT exercise_sets_recording_mode_valid CHECK(recording_mode IN ('reps', 'hold'));--> statement-breakpoint
ALTER TABLE exercise_sets ADD duration_sec integer;--> statement-breakpoint
DROP TRIGGER `exercise_session_facts_exercise_sets_update`;--> statement-breakpoint
CREATE TRIGGER `exercise_session_facts_exercise_sets_update`
AFTER UPDATE OF `session_exercise_id`, `order_index`, `weight_value`, `reps_value`, `set_type`,
  `performance_status`, `deleted_at`, `recording_mode`, `duration_sec` ON `exercise_sets`
WHEN OLD.`session_exercise_id` IS NOT NEW.`session_exercise_id`
  OR OLD.`order_index` IS NOT NEW.`order_index`
  OR OLD.`weight_value` IS NOT NEW.`weight_value`
  OR OLD.`reps_value` IS NOT NEW.`reps_value`
  OR OLD.`set_type` IS NOT NEW.`set_type`
  OR OLD.`performance_status` IS NOT NEW.`performance_status`
  OR OLD.`deleted_at` IS NOT NEW.`deleted_at`
  OR OLD.`recording_mode` IS NOT NEW.`recording_mode`
  OR OLD.`duration_sec` IS NOT NEW.`duration_sec`
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  SELECT se.`exercise_definition_id`
  FROM `session_exercises` se JOIN `sessions` s ON s.`id` = se.`session_id`
  WHERE se.`id` IN (OLD.`session_exercise_id`, NEW.`session_exercise_id`)
    AND se.`exercise_definition_id` IS NOT NULL AND s.`status` = 'completed';
END;
--> statement-breakpoint
UPDATE sync_runtime_state SET pull_cursor = '{}';
