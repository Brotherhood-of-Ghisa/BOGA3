ALTER TABLE `body_weight_measurements` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `body_weight_measurements` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `body_weight_measurements` ADD `ignored` integer DEFAULT false NOT NULL;