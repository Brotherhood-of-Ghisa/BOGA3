CREATE TABLE `exercise_session_facts` (
	`session_id` text NOT NULL,
	`exercise_definition_id` text NOT NULL,
	`achieved_at` integer NOT NULL,
	`best_e1rm_kg` real,
	`best_e1rm_set_id` text,
	`top_weight_kg` real,
	`top_weight_set_id` text,
	`volume_kg` real,
	`volume_complete` integer NOT NULL,
	`working_sets` integer NOT NULL,
	`pr_e1rm` integer NOT NULL,
	`pr_weight` integer NOT NULL,
	`pr_volume` integer NOT NULL,
	PRIMARY KEY(`exercise_definition_id`, `session_id`)
);
--> statement-breakpoint
CREATE INDEX `exercise_session_facts_definition_achieved_at_idx` ON `exercise_session_facts` (`exercise_definition_id`,`achieved_at`);--> statement-breakpoint
CREATE INDEX `exercise_session_facts_achieved_at_idx` ON `exercise_session_facts` (`achieved_at`);--> statement-breakpoint
CREATE TABLE `exercise_session_facts_stale` (
	`exercise_definition_id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exercise_session_facts_state` (
	`id` text PRIMARY KEY DEFAULT 'facts' NOT NULL,
	`rules_version` integer NOT NULL
);
