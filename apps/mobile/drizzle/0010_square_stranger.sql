ALTER TABLE `exercise_definitions` RENAME COLUMN "bodyweight_coefficient" TO "bodyweight_contribution";--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY DEFAULT 'settings' NOT NULL,
	`bodyweight_calculations_enabled` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	`local_dirty` integer DEFAULT false NOT NULL,
	`local_updated_at_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "user_settings_singleton" CHECK("user_settings"."id" = 'settings')
);
--> statement-breakpoint
CREATE INDEX `user_settings_deleted_at_idx` ON `user_settings` (`deleted_at`);--> statement-breakpoint
UPDATE `exercise_sets`
SET `weight_value` = CASE
      WHEN `weight_unit` = 'lb'
        AND (CASE WHEN substr(trim(`weight_value`), 1, 1) = '+' THEN substr(trim(`weight_value`), 2) ELSE trim(`weight_value`) END) <> ''
        AND (CASE WHEN substr(trim(`weight_value`), 1, 1) = '+' THEN substr(trim(`weight_value`), 2) ELSE trim(`weight_value`) END) NOT GLOB '*[^0-9.]*'
        AND (CASE WHEN substr(trim(`weight_value`), 1, 1) = '+' THEN substr(trim(`weight_value`), 2) ELSE trim(`weight_value`) END) GLOB '*[0-9]*'
        AND (CASE WHEN substr(trim(`weight_value`), 1, 1) = '+' THEN substr(trim(`weight_value`), 2) ELSE trim(`weight_value`) END) NOT GLOB '*.*.*'
        AND CAST(`weight_value` AS real) <= 1.7976931348623157e308
      THEN CAST(CAST(`weight_value` AS real) * 0.45359237 AS text)
      ELSE `weight_value`
    END,
    `planned_weight_value` = CASE
      WHEN `planned_weight_unit` = 'lb'
        AND (CASE WHEN substr(trim(`planned_weight_value`), 1, 1) = '+' THEN substr(trim(`planned_weight_value`), 2) ELSE trim(`planned_weight_value`) END) <> ''
        AND (CASE WHEN substr(trim(`planned_weight_value`), 1, 1) = '+' THEN substr(trim(`planned_weight_value`), 2) ELSE trim(`planned_weight_value`) END) NOT GLOB '*[^0-9.]*'
        AND (CASE WHEN substr(trim(`planned_weight_value`), 1, 1) = '+' THEN substr(trim(`planned_weight_value`), 2) ELSE trim(`planned_weight_value`) END) GLOB '*[0-9]*'
        AND (CASE WHEN substr(trim(`planned_weight_value`), 1, 1) = '+' THEN substr(trim(`planned_weight_value`), 2) ELSE trim(`planned_weight_value`) END) NOT GLOB '*.*.*'
        AND CAST(`planned_weight_value` AS real) <= 1.7976931348623157e308
      THEN CAST(CAST(`planned_weight_value` AS real) * 0.45359237 AS text)
      ELSE `planned_weight_value`
    END;--> statement-breakpoint
ALTER TABLE `exercise_definitions` DROP COLUMN `movement_standard`;--> statement-breakpoint
ALTER TABLE `exercise_definitions` DROP COLUMN `loading_method`;--> statement-breakpoint
ALTER TABLE `exercise_definitions` DROP COLUMN `local_bodyweight_metadata_known`;--> statement-breakpoint
ALTER TABLE `body_weight_measurements` DROP COLUMN `weight_value`;--> statement-breakpoint
ALTER TABLE `body_weight_measurements` DROP COLUMN `weight_unit`;--> statement-breakpoint
ALTER TABLE `exercise_sets` DROP COLUMN `weight_unit`;--> statement-breakpoint
ALTER TABLE `exercise_sets` DROP COLUMN `external_load_mode`;--> statement-breakpoint
ALTER TABLE `exercise_sets` DROP COLUMN `planned_weight_unit`;--> statement-breakpoint
ALTER TABLE `exercise_sets` DROP COLUMN `planned_external_load_mode`;--> statement-breakpoint
ALTER TABLE `exercise_sets` DROP COLUMN `local_bodyweight_metadata_known`;
