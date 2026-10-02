-- Exercise session facts are derived from the raw training rows (spec 05,
-- "Exercise session facts"). Every write that can change a definition's facts
-- queues that definition here, whatever path made it: the recorder,
-- completed-session edits, the session list, sync pull-apply, imports, dev
-- reset. The TS drain in src/data/exercise-session-facts.ts rebuilds queued
-- definitions before any facts read.
--
-- Changes inside active sessions queue nothing: active sessions have no facts,
-- and completing a session queues all of its definitions.

-- sessions: completion, reopening, backdating, the as-of bodyweight date, and
-- soft delete or undelete. Hard deletes cascade to session_exercises, whose
-- delete trigger queues the definitions.
CREATE TRIGGER `exercise_session_facts_sessions_insert`
AFTER INSERT ON `sessions`
WHEN NEW.`status` = 'completed'
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  SELECT `exercise_definition_id` FROM `session_exercises`
  WHERE `session_id` = NEW.`id` AND `exercise_definition_id` IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `exercise_session_facts_sessions_update`
AFTER UPDATE OF `status`, `completed_at`, `started_at`, `deleted_at` ON `sessions`
WHEN (OLD.`status` = 'completed' OR NEW.`status` = 'completed')
  AND (OLD.`status` IS NOT NEW.`status`
    OR OLD.`completed_at` IS NOT NEW.`completed_at`
    OR OLD.`started_at` IS NOT NEW.`started_at`
    OR OLD.`deleted_at` IS NOT NEW.`deleted_at`)
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  SELECT `exercise_definition_id` FROM `session_exercises`
  WHERE `session_id` = NEW.`id` AND `exercise_definition_id` IS NOT NULL;
END;
--> statement-breakpoint
-- session_exercises: adding, relinking, moving, reordering or deleting a block.
CREATE TRIGGER `exercise_session_facts_session_exercises_insert`
AFTER INSERT ON `session_exercises`
WHEN NEW.`exercise_definition_id` IS NOT NULL
  AND EXISTS (SELECT 1 FROM `sessions` WHERE `id` = NEW.`session_id` AND `status` = 'completed')
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  VALUES (NEW.`exercise_definition_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `exercise_session_facts_session_exercises_update`
AFTER UPDATE OF `session_id`, `exercise_definition_id`, `order_index`, `deleted_at` ON `session_exercises`
WHEN (OLD.`session_id` IS NOT NEW.`session_id`
    OR OLD.`exercise_definition_id` IS NOT NEW.`exercise_definition_id`
    OR OLD.`order_index` IS NOT NEW.`order_index`
    OR OLD.`deleted_at` IS NOT NEW.`deleted_at`)
  AND EXISTS (
    SELECT 1 FROM `sessions`
    WHERE `id` IN (OLD.`session_id`, NEW.`session_id`) AND `status` = 'completed'
  )
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  SELECT `value` FROM (
    SELECT OLD.`exercise_definition_id` AS `value`
    UNION SELECT NEW.`exercise_definition_id`
  ) WHERE `value` IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `exercise_session_facts_session_exercises_delete`
AFTER DELETE ON `session_exercises`
WHEN OLD.`exercise_definition_id` IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  VALUES (OLD.`exercise_definition_id`);
END;
--> statement-breakpoint
-- exercise_sets: any value, order, type, status or delete change.
CREATE TRIGGER `exercise_session_facts_exercise_sets_insert`
AFTER INSERT ON `exercise_sets`
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  SELECT se.`exercise_definition_id`
  FROM `session_exercises` se JOIN `sessions` s ON s.`id` = se.`session_id`
  WHERE se.`id` = NEW.`session_exercise_id`
    AND se.`exercise_definition_id` IS NOT NULL AND s.`status` = 'completed';
END;
--> statement-breakpoint
CREATE TRIGGER `exercise_session_facts_exercise_sets_update`
AFTER UPDATE OF `session_exercise_id`, `order_index`, `weight_value`, `reps_value`, `set_type`,
  `performance_status`, `deleted_at` ON `exercise_sets`
WHEN OLD.`session_exercise_id` IS NOT NEW.`session_exercise_id`
  OR OLD.`order_index` IS NOT NEW.`order_index`
  OR OLD.`weight_value` IS NOT NEW.`weight_value`
  OR OLD.`reps_value` IS NOT NEW.`reps_value`
  OR OLD.`set_type` IS NOT NEW.`set_type`
  OR OLD.`performance_status` IS NOT NEW.`performance_status`
  OR OLD.`deleted_at` IS NOT NEW.`deleted_at`
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  SELECT se.`exercise_definition_id`
  FROM `session_exercises` se JOIN `sessions` s ON s.`id` = se.`session_id`
  WHERE se.`id` IN (OLD.`session_exercise_id`, NEW.`session_exercise_id`)
    AND se.`exercise_definition_id` IS NOT NULL AND s.`status` = 'completed';
END;
--> statement-breakpoint
CREATE TRIGGER `exercise_session_facts_exercise_sets_delete`
AFTER DELETE ON `exercise_sets`
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  SELECT se.`exercise_definition_id`
  FROM `session_exercises` se JOIN `sessions` s ON s.`id` = se.`session_id`
  WHERE se.`id` = OLD.`session_exercise_id`
    AND se.`exercise_definition_id` IS NOT NULL AND s.`status` = 'completed';
END;
--> statement-breakpoint
-- Policy: a definition's load mode or bodyweight contribution.
CREATE TRIGGER `exercise_session_facts_exercise_definitions_update`
AFTER UPDATE OF `load_input_mode`, `bodyweight_contribution` ON `exercise_definitions`
WHEN OLD.`load_input_mode` IS NOT NEW.`load_input_mode`
  OR OLD.`bodyweight_contribution` IS NOT NEW.`bodyweight_contribution`
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  VALUES (NEW.`id`);
END;
--> statement-breakpoint
-- Policy: the bodyweight-calculations toggle. Only definitions with a positive
-- contribution calculate differently under it.
CREATE TRIGGER `exercise_session_facts_user_settings_insert`
AFTER INSERT ON `user_settings`
WHEN NEW.`bodyweight_calculations_enabled` = 1
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  SELECT `id` FROM `exercise_definitions` WHERE `bodyweight_contribution` > 0;
END;
--> statement-breakpoint
CREATE TRIGGER `exercise_session_facts_user_settings_update`
AFTER UPDATE OF `bodyweight_calculations_enabled` ON `user_settings`
WHEN OLD.`bodyweight_calculations_enabled` IS NOT NEW.`bodyweight_calculations_enabled`
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  SELECT `id` FROM `exercise_definitions` WHERE `bodyweight_contribution` > 0;
END;
--> statement-breakpoint
CREATE TRIGGER `exercise_session_facts_user_settings_delete`
AFTER DELETE ON `user_settings`
WHEN OLD.`bodyweight_calculations_enabled` = 1
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  SELECT `id` FROM `exercise_definitions` WHERE `bodyweight_contribution` > 0;
END;
--> statement-breakpoint
-- Policy: a bodyweight reading changes the as-of weight of later sessions. It
-- matters only while bodyweight calculations are on.
CREATE TRIGGER `exercise_session_facts_body_weight_insert`
AFTER INSERT ON `body_weight_measurements`
WHEN EXISTS (SELECT 1 FROM `user_settings` WHERE `bodyweight_calculations_enabled` = 1)
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  SELECT `id` FROM `exercise_definitions` WHERE `bodyweight_contribution` > 0;
END;
--> statement-breakpoint
CREATE TRIGGER `exercise_session_facts_body_weight_update`
AFTER UPDATE OF `weight_kg`, `measured_at`, `deleted_at` ON `body_weight_measurements`
WHEN (OLD.`weight_kg` IS NOT NEW.`weight_kg`
    OR OLD.`measured_at` IS NOT NEW.`measured_at`
    OR OLD.`deleted_at` IS NOT NEW.`deleted_at`)
  AND EXISTS (SELECT 1 FROM `user_settings` WHERE `bodyweight_calculations_enabled` = 1)
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  SELECT `id` FROM `exercise_definitions` WHERE `bodyweight_contribution` > 0;
END;
--> statement-breakpoint
CREATE TRIGGER `exercise_session_facts_body_weight_delete`
AFTER DELETE ON `body_weight_measurements`
WHEN EXISTS (SELECT 1 FROM `user_settings` WHERE `bodyweight_calculations_enabled` = 1)
BEGIN
  INSERT OR IGNORE INTO `exercise_session_facts_stale` (`exercise_definition_id`)
  SELECT `id` FROM `exercise_definitions` WHERE `bodyweight_contribution` > 0;
END;
