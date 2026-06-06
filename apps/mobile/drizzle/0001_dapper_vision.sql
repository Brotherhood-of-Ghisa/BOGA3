CREATE TABLE `sync_quarantine` (
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`error_code` text NOT NULL,
	`parent_type` text,
	`parent_id_field` text,
	`parent_id` text,
	`first_seen_at_ms` integer NOT NULL,
	`last_seen_at_ms` integer NOT NULL,
	`occurrence_count` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`entity_type`, `entity_id`)
);
