ALTER TABLE `training_programmes` ADD `last_modified_by` text DEFAULT 'human' NOT NULL CHECK (`last_modified_by` in ('human', 'agent'));--> statement-breakpoint
ALTER TABLE `session_plans` ADD `last_modified_by` text DEFAULT 'human' NOT NULL CHECK (`last_modified_by` in ('human', 'agent'));--> statement-breakpoint
ALTER TABLE `session_plan_exercises` ADD `last_modified_by` text DEFAULT 'human' NOT NULL CHECK (`last_modified_by` in ('human', 'agent'));--> statement-breakpoint
ALTER TABLE `session_plan_sets` ADD `last_modified_by` text DEFAULT 'human' NOT NULL CHECK (`last_modified_by` in ('human', 'agent'));
