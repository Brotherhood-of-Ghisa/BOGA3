-- Records, PR flags and `Last` are keyed on (definition, reporting bucket)
-- ([[gym.split]]): every gym pooled, unless the definition is split per gym,
-- when the bucket is the session's own gym. The rules-version bump in
-- exercise-session-facts-derive.ts rebuilds every row, so the column default
-- never stands in for a real bucket.
ALTER TABLE `exercise_session_facts` ADD `gym_bucket` text DEFAULT 'all' NOT NULL;--> statement-breakpoint
CREATE INDEX `exercise_session_facts_definition_bucket_idx` ON `exercise_session_facts` (`exercise_definition_id`,`gym_bucket`,`achieved_at`);
--> statement-breakpoint
-- A session's gym now selects its bucket, so moving a completed session to
-- another gym re-folds every definition it performed. SQLite cannot alter a
-- trigger, so the one from migration 0012 is replaced whole.
DROP TRIGGER `exercise_session_facts_sessions_update`;
--> statement-breakpoint
CREATE TRIGGER `exercise_session_facts_sessions_update`
AFTER UPDATE OF `status`, `completed_at`, `started_at`, `gym_id`, `deleted_at` ON `sessions`
WHEN (OLD.`status` = 'completed' OR NEW.`status` = 'completed')
  AND (OLD.`status` IS NOT NEW.`status`
    OR OLD.`completed_at` IS NOT NEW.`completed_at`
    OR OLD.`started_at` IS NOT NEW.`started_at`
    OR OLD.`gym_id` IS NOT NEW.`gym_id`
    OR OLD.`deleted_at` IS NOT NEW.`deleted_at`)
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  SELECT `exercise_definition_id` FROM `session_exercises`
  WHERE `session_id` = NEW.`id` AND `exercise_definition_id` IS NOT NULL;
END;
--> statement-breakpoint
-- Toggling the split re-folds that definition's whole history, PRs included.
DROP TRIGGER `exercise_session_facts_exercise_definitions_update`;
--> statement-breakpoint
CREATE TRIGGER `exercise_session_facts_exercise_definitions_update`
AFTER UPDATE OF `load_input_mode`, `bodyweight_contribution`, `split_by_gym` ON `exercise_definitions`
WHEN OLD.`load_input_mode` IS NOT NEW.`load_input_mode`
  OR OLD.`bodyweight_contribution` IS NOT NEW.`bodyweight_contribution`
  OR OLD.`split_by_gym` IS NOT NEW.`split_by_gym`
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  VALUES (NEW.`id`);
END;
