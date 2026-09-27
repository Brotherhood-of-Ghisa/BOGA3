ALTER TABLE `sessions` DROP COLUMN `body_weight_kg`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `body_weight_source`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `body_weight_measurement_id`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `body_weight_measured_at`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `local_bodyweight_metadata_known`;
--> statement-breakpoint
DELETE FROM `group_cache`;
