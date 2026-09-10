CREATE TABLE `group_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`fetched_at_ms` integer NOT NULL
);
