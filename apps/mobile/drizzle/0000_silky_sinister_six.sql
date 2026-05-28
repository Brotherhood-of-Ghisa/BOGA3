CREATE TABLE `exercise_definitions` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`name` text NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "exercise_definitions_name_non_empty" CHECK("exercise_definitions"."name" <> '')
);
--> statement-breakpoint
CREATE INDEX `exercise_definitions_name_idx` ON `exercise_definitions` (`name`);--> statement-breakpoint
CREATE INDEX `exercise_definitions_deleted_at_idx` ON `exercise_definitions` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `exercise_muscle_mappings` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`exercise_definition_id` text NOT NULL,
	`muscle_group_id` text NOT NULL,
	`weight` real NOT NULL,
	`role` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`exercise_definition_id`) REFERENCES `exercise_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`muscle_group_id`) REFERENCES `muscle_groups`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exercise_muscle_mappings_weight_positive" CHECK("exercise_muscle_mappings"."weight" > 0),
	CONSTRAINT "exercise_muscle_mappings_role_guard" CHECK("exercise_muscle_mappings"."role" is null or "exercise_muscle_mappings"."role" in ('primary', 'secondary', 'stabilizer'))
);
--> statement-breakpoint
CREATE INDEX `exercise_muscle_mappings_exercise_definition_id_idx` ON `exercise_muscle_mappings` (`exercise_definition_id`);--> statement-breakpoint
CREATE INDEX `exercise_muscle_mappings_muscle_group_id_idx` ON `exercise_muscle_mappings` (`muscle_group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_muscle_mappings_exercise_id_muscle_group_id_unique` ON `exercise_muscle_mappings` (`exercise_definition_id`,`muscle_group_id`);--> statement-breakpoint
CREATE TABLE `exercise_sets` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`session_exercise_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`weight_value` text DEFAULT '' NOT NULL,
	`reps_value` text DEFAULT '' NOT NULL,
	`set_type` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_exercise_id`) REFERENCES `session_exercises`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "exercise_sets_order_index_non_negative" CHECK("exercise_sets"."order_index" >= 0)
);
--> statement-breakpoint
CREATE INDEX `exercise_sets_session_exercise_id_idx` ON `exercise_sets` (`session_exercise_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_sets_session_exercise_id_order_index_unique` ON `exercise_sets` (`session_exercise_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `exercise_tag_definitions` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`exercise_definition_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`exercise_definition_id`) REFERENCES `exercise_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "exercise_tag_definitions_name_non_empty" CHECK("exercise_tag_definitions"."name" <> ''),
	CONSTRAINT "exercise_tag_definitions_normalized_name_non_empty" CHECK("exercise_tag_definitions"."normalized_name" <> '')
);
--> statement-breakpoint
CREATE INDEX `exercise_tag_definitions_exercise_definition_id_idx` ON `exercise_tag_definitions` (`exercise_definition_id`);--> statement-breakpoint
CREATE INDEX `exercise_tag_definitions_deleted_at_idx` ON `exercise_tag_definitions` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_tag_definitions_exercise_id_normalized_name_unique` ON `exercise_tag_definitions` (`exercise_definition_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `gyms` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`name` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`coordinate_accuracy_m` real,
	`coordinates_updated_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "gyms_latitude_range" CHECK("gyms"."latitude" is null or ("gyms"."latitude" >= -90 and "gyms"."latitude" <= 90)),
	CONSTRAINT "gyms_longitude_range" CHECK("gyms"."longitude" is null or ("gyms"."longitude" >= -180 and "gyms"."longitude" <= 180)),
	CONSTRAINT "gyms_coordinate_accuracy_non_negative" CHECK("gyms"."coordinate_accuracy_m" is null or "gyms"."coordinate_accuracy_m" >= 0),
	CONSTRAINT "gyms_coordinates_updated_at_non_negative" CHECK("gyms"."coordinates_updated_at" is null or "gyms"."coordinates_updated_at" >= 0),
	CONSTRAINT "gyms_coordinate_shape" CHECK((
        "gyms"."latitude" is null
        and "gyms"."longitude" is null
        and "gyms"."coordinate_accuracy_m" is null
        and "gyms"."coordinates_updated_at" is null
      ) or (
        "gyms"."latitude" is not null
        and "gyms"."longitude" is not null
        and "gyms"."coordinate_accuracy_m" is not null
        and "gyms"."coordinates_updated_at" is not null
      ))
);
--> statement-breakpoint
CREATE INDEX `gyms_name_idx` ON `gyms` (`name`);--> statement-breakpoint
CREATE TABLE `muscle_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`family_name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_editable` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "muscle_groups_sort_order_non_negative" CHECK("muscle_groups"."sort_order" >= 0),
	CONSTRAINT "muscle_groups_is_editable_boolean_guard" CHECK("muscle_groups"."is_editable" in (0, 1)),
	CONSTRAINT "muscle_groups_non_editable_guard" CHECK("muscle_groups"."is_editable" = 0)
);
--> statement-breakpoint
CREATE INDEX `muscle_groups_family_name_idx` ON `muscle_groups` (`family_name`);--> statement-breakpoint
CREATE INDEX `muscle_groups_sort_order_idx` ON `muscle_groups` (`sort_order`);--> statement-breakpoint
CREATE INDEX `muscle_groups_display_name_idx` ON `muscle_groups` (`display_name`);--> statement-breakpoint
CREATE TABLE `session_exercise_tags` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`session_exercise_id` text NOT NULL,
	`exercise_tag_definition_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_exercise_id`) REFERENCES `session_exercises`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_tag_definition_id`) REFERENCES `exercise_tag_definitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_exercise_tags_session_exercise_id_idx` ON `session_exercise_tags` (`session_exercise_id`);--> statement-breakpoint
CREATE INDEX `session_exercise_tags_exercise_tag_definition_id_idx` ON `session_exercise_tags` (`exercise_tag_definition_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_exercise_tags_session_exercise_id_tag_definition_unique` ON `session_exercise_tags` (`session_exercise_id`,`exercise_tag_definition_id`);--> statement-breakpoint
CREATE TABLE `session_exercises` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`session_id` text NOT NULL,
	`exercise_definition_id` text,
	`order_index` integer NOT NULL,
	`name` text NOT NULL,
	`machine_name` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_definition_id`) REFERENCES `exercise_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "session_exercises_order_index_non_negative" CHECK("session_exercises"."order_index" >= 0)
);
--> statement-breakpoint
CREATE INDEX `session_exercises_session_id_idx` ON `session_exercises` (`session_id`);--> statement-breakpoint
CREATE INDEX `session_exercises_exercise_definition_id_idx` ON `session_exercises` (`exercise_definition_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_exercises_session_id_order_index_unique` ON `session_exercises` (`session_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`gym_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`duration_sec` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`gym_id`) REFERENCES `gyms`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sessions_status_guard" CHECK("sessions"."status" in ('active', 'completed')),
	CONSTRAINT "sessions_duration_non_negative" CHECK("sessions"."duration_sec" is null or "sessions"."duration_sec" >= 0)
);
--> statement-breakpoint
CREATE INDEX `sessions_status_idx` ON `sessions` (`status`);--> statement-breakpoint
CREATE INDEX `sessions_completed_at_idx` ON `sessions` (`completed_at`);--> statement-breakpoint
CREATE INDEX `sessions_deleted_at_idx` ON `sessions` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `sync_runtime_state` (
	`id` text PRIMARY KEY NOT NULL,
	`is_enabled` integer DEFAULT 0 NOT NULL,
	`bootstrap_user_id` text,
	`bootstrap_completed_at` integer,
	`last_bootstrap_error` text,
	`last_bootstrap_attempt_at` integer,
	`seeds_applied_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "sync_runtime_state_is_enabled_boolean_guard" CHECK("sync_runtime_state"."is_enabled" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `smoke_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
