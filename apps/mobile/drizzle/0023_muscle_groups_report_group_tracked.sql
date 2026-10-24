ALTER TABLE `muscle_groups` ADD `report_group` text;--> statement-breakpoint
ALTER TABLE `muscle_groups` ADD `tracked` integer DEFAULT 1 NOT NULL CONSTRAINT "muscle_groups_tracked_boolean_guard" CHECK (`tracked` in (0, 1));
