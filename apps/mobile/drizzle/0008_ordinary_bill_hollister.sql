ALTER TABLE `exercise_definitions` ADD `local_bodyweight_metadata_known` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `exercise_sets` ADD `local_bodyweight_metadata_known` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `local_bodyweight_metadata_known` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- Existing rows came from a client that could ignore M27 fields while still
-- advancing its cursors. Mark only those pre-upgrade rows unknown. New inserts
-- use the schema default true. No dirty bit or LWW clock is changed.
UPDATE `exercise_definitions` SET `local_bodyweight_metadata_known` = false;
--> statement-breakpoint
UPDATE `exercise_sets` SET `local_bodyweight_metadata_known` = false;
--> statement-breakpoint
UPDATE `sessions` SET `local_bodyweight_metadata_known` = false;
--> statement-breakpoint
-- Replay affected projections once, preserving unrelated cursor 2 and all
-- runtime bookkeeping. A separate, initially absent cursor covers readings.
UPDATE `sync_runtime_state` SET `pull_cursor` = json_remove(
  CASE
    WHEN NOT json_valid(`pull_cursor`) THEN '{}'
    WHEN json_type(`pull_cursor`) = 'text' THEN json_extract(`pull_cursor`, '$')
    ELSE `pull_cursor`
  END,
  '$."0"', '$."1"', '$."3"'
);
