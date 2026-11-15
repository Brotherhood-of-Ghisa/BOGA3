ALTER TABLE `training_notes` ADD `author` text;--> statement-breakpoint
ALTER TABLE `training_notes` ADD `client_id` text;--> statement-breakpoint
ALTER TABLE `training_notes` ADD `session_id` text;--> statement-breakpoint
ALTER TABLE `training_notes` ADD `set_id` text;--> statement-breakpoint
ALTER TABLE `training_notes` ADD `activity_source` text;--> statement-breakpoint
ALTER TABLE `training_notes` ADD `activity_external_id` text;--> statement-breakpoint
ALTER TABLE `training_notes` ADD `target_label` text;--> statement-breakpoint
ALTER TABLE `training_notes` ADD `target_started_at` integer;
--> statement-breakpoint
-- Rehydrate creation metadata an older build discarded at the same clock.
UPDATE training_notes SET local_updated_at_ms = 0 WHERE local_dirty = 0;--> statement-breakpoint
UPDATE sync_runtime_state SET pull_cursor = '{}';
