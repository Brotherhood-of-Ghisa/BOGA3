ALTER TABLE `user_settings` ADD `muscle_targets` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `combined_muscles` text;--> statement-breakpoint
-- Re-pull every row once: a row an older build pulled reached this device
-- without the new columns, and the combined-muscle migration must see another
-- device's definitions before it writes its own.
UPDATE sync_runtime_state SET pull_cursor = '{}';
