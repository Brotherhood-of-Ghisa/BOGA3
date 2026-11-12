ALTER TABLE `user_settings` ADD `muscle_targets` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `combined_muscles` text;--> statement-breakpoint
-- A clean settings row an older build pulled reached this device without the
-- new columns, at the server's stamp, where a replay would be a no-op. Zero its
-- stamp so the re-pull below applies it again: the combined-muscle migration
-- must see another device's definitions before it writes its own.
UPDATE user_settings SET local_updated_at_ms = 0 WHERE local_dirty = 0;--> statement-breakpoint
-- Re-pull every row once.
UPDATE sync_runtime_state SET pull_cursor = '{}';
