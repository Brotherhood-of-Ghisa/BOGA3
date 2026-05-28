import type { migrate as migrateExpoSqlite } from 'drizzle-orm/expo-sqlite/migrator';

type RuntimeMigrationConfig = Parameters<typeof migrateExpoSqlite>[1];

export const localRuntimeMigrations: RuntimeMigrationConfig = {
  // Keep this bundle aligned with files generated under apps/mobile/drizzle/**.
  journal: {
    entries: [
      {
        idx: 0,
        when: 1771519674243,
        tag: '0000_quiet_famine',
        breakpoints: true,
      },
      {
        idx: 1,
        when: 1771597303513,
        tag: '0001_wet_moondragon',
        breakpoints: true,
      },
      {
        idx: 2,
        when: 1771865922639,
        tag: '0002_pink_justice',
        breakpoints: true,
      },
      {
        idx: 3,
        when: 1771955085482,
        tag: '0003_tiny_captain_universe',
        breakpoints: true,
      },
      {
        idx: 4,
        when: 1772125192000,
        tag: '0004_active_completed_lifecycle',
        breakpoints: true,
      },
      {
        idx: 5,
        when: 1772190386093,
        tag: '0005_slimy_iron_lad',
        breakpoints: true,
      },
      {
        idx: 6,
        when: 1772635381085,
        tag: '0006_noisy_vector',
        breakpoints: true,
      },
      {
        idx: 7,
        when: 1772806400000,
        tag: '0007_sync_outbox_delivery_state',
        breakpoints: true,
      },
      {
        idx: 8,
        when: 1772808600000,
        tag: '0008_sync_runtime_state',
        breakpoints: true,
      },
      {
        idx: 9,
        when: 1772884800000,
        tag: '0009_set_type_metadata',
        breakpoints: true,
      },
      {
        idx: 10,
        when: 1778799600000,
        tag: '0010_sync_runtime_attempt',
        breakpoints: true,
      },
      {
        idx: 11,
        when: 1778790600000,
        tag: '0011_drop_origin_columns',
        breakpoints: true,
      },
      {
        idx: 12,
        when: 1779491400000,
        tag: '0012_seeds_applied_at',
        breakpoints: true,
      },
      {
        idx: 13,
        when: 1779541826568,
        tag: '0013_gym_coordinates',
        breakpoints: true,
      },
      {
        idx: 14,
        when: 1780099200000,
        tag: '0014_drop_v1_sync_tables',
        breakpoints: true,
      },
    ],
  },
  migrations: {
    m0000: `CREATE TABLE \`smoke_records\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`value\` text NOT NULL,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
`,
    m0001: `CREATE TABLE \`exercise_sets\` (
	\`id\` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	\`session_exercise_id\` text NOT NULL,
	\`order_index\` integer NOT NULL,
	\`weight_value\` text DEFAULT '' NOT NULL,
	\`reps_value\` text DEFAULT '' NOT NULL,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (\`session_exercise_id\`) REFERENCES \`session_exercises\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "exercise_sets_order_index_non_negative" CHECK("exercise_sets"."order_index" >= 0)
);
--> statement-breakpoint
CREATE INDEX \`exercise_sets_session_exercise_id_idx\` ON \`exercise_sets\` (\`session_exercise_id\`);--> statement-breakpoint
CREATE UNIQUE INDEX \`exercise_sets_session_exercise_id_order_index_unique\` ON \`exercise_sets\` (\`session_exercise_id\`,\`order_index\`);--> statement-breakpoint
CREATE TABLE \`gyms\` (
	\`id\` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	\`name\` text NOT NULL,
	\`origin_scope_id\` text DEFAULT 'private' NOT NULL,
	\`origin_source_id\` text DEFAULT 'local' NOT NULL,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX \`gyms_name_idx\` ON \`gyms\` (\`name\`);--> statement-breakpoint
CREATE INDEX \`gyms_origin_scope_id_idx\` ON \`gyms\` (\`origin_scope_id\`);--> statement-breakpoint
CREATE TABLE \`session_exercises\` (
	\`id\` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	\`session_id\` text NOT NULL,
	\`order_index\` integer NOT NULL,
	\`name\` text NOT NULL,
	\`machine_name\` text,
	\`origin_scope_id\` text DEFAULT 'private' NOT NULL,
	\`origin_source_id\` text DEFAULT 'local' NOT NULL,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (\`session_id\`) REFERENCES \`sessions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "session_exercises_order_index_non_negative" CHECK("session_exercises"."order_index" >= 0)
);
--> statement-breakpoint
CREATE INDEX \`session_exercises_session_id_idx\` ON \`session_exercises\` (\`session_id\`);--> statement-breakpoint
CREATE UNIQUE INDEX \`session_exercises_session_id_order_index_unique\` ON \`session_exercises\` (\`session_id\`,\`order_index\`);--> statement-breakpoint
CREATE TABLE \`sessions\` (
	\`id\` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	\`gym_id\` text,
	\`status\` text DEFAULT 'draft' NOT NULL,
	\`started_at\` integer NOT NULL,
	\`completed_at\` integer,
	\`duration_sec\` integer,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (\`gym_id\`) REFERENCES \`gyms\`(\`id\`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sessions_status_guard" CHECK("sessions"."status" in ('draft', 'active', 'completed')),
	CONSTRAINT "sessions_duration_non_negative" CHECK("sessions"."duration_sec" is null or "sessions"."duration_sec" >= 0)
);
--> statement-breakpoint
CREATE INDEX \`sessions_status_idx\` ON \`sessions\` (\`status\`);--> statement-breakpoint
CREATE INDEX \`sessions_completed_at_idx\` ON \`sessions\` (\`completed_at\`);
`,
    m0002: `ALTER TABLE \`sessions\` ADD \`deleted_at\` integer;--> statement-breakpoint
CREATE INDEX \`sessions_deleted_at_idx\` ON \`sessions\` (\`deleted_at\`);`,
    m0003: `CREATE TABLE \`exercise_definitions\` (
	\`id\` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	\`name\` text NOT NULL,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "exercise_definitions_name_non_empty" CHECK("exercise_definitions"."name" <> '')
);
--> statement-breakpoint
CREATE INDEX \`exercise_definitions_name_idx\` ON \`exercise_definitions\` (\`name\`);--> statement-breakpoint
CREATE TABLE \`exercise_muscle_mappings\` (
	\`id\` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	\`exercise_definition_id\` text NOT NULL,
	\`muscle_group_id\` text NOT NULL,
	\`weight\` real NOT NULL,
	\`role\` text,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (\`exercise_definition_id\`) REFERENCES \`exercise_definitions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`muscle_group_id\`) REFERENCES \`muscle_groups\`(\`id\`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exercise_muscle_mappings_weight_positive" CHECK("exercise_muscle_mappings"."weight" > 0),
	CONSTRAINT "exercise_muscle_mappings_role_guard" CHECK("exercise_muscle_mappings"."role" is null or "exercise_muscle_mappings"."role" in ('primary', 'secondary', 'stabilizer'))
);
--> statement-breakpoint
CREATE INDEX \`exercise_muscle_mappings_exercise_definition_id_idx\` ON \`exercise_muscle_mappings\` (\`exercise_definition_id\`);--> statement-breakpoint
CREATE INDEX \`exercise_muscle_mappings_muscle_group_id_idx\` ON \`exercise_muscle_mappings\` (\`muscle_group_id\`);--> statement-breakpoint
CREATE UNIQUE INDEX \`exercise_muscle_mappings_exercise_id_muscle_group_id_unique\` ON \`exercise_muscle_mappings\` (\`exercise_definition_id\`,\`muscle_group_id\`);--> statement-breakpoint
CREATE TABLE \`muscle_groups\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`display_name\` text NOT NULL,
	\`family_name\` text NOT NULL,
	\`sort_order\` integer DEFAULT 0 NOT NULL,
	\`is_editable\` integer DEFAULT 0 NOT NULL,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "muscle_groups_sort_order_non_negative" CHECK("muscle_groups"."sort_order" >= 0),
	CONSTRAINT "muscle_groups_is_editable_boolean_guard" CHECK("muscle_groups"."is_editable" in (0, 1)),
	CONSTRAINT "muscle_groups_non_editable_guard" CHECK("muscle_groups"."is_editable" = 0)
);
--> statement-breakpoint
CREATE INDEX \`muscle_groups_family_name_idx\` ON \`muscle_groups\` (\`family_name\`);--> statement-breakpoint
CREATE INDEX \`muscle_groups_sort_order_idx\` ON \`muscle_groups\` (\`sort_order\`);--> statement-breakpoint
CREATE INDEX \`muscle_groups_display_name_idx\` ON \`muscle_groups\` (\`display_name\`);`,
    m0004: `PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE \`__new_sessions\` (
	\`id\` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	\`gym_id\` text,
	\`status\` text DEFAULT 'active' NOT NULL,
	\`started_at\` integer NOT NULL,
	\`completed_at\` integer,
	\`duration_sec\` integer,
	\`deleted_at\` integer,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (\`gym_id\`) REFERENCES \`gyms\`(\`id\`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sessions_status_guard" CHECK("status" in ('active', 'completed')),
	CONSTRAINT "sessions_duration_non_negative" CHECK("duration_sec" is null or "duration_sec" >= 0)
);
--> statement-breakpoint
INSERT INTO \`__new_sessions\` (\`id\`, \`gym_id\`, \`status\`, \`started_at\`, \`completed_at\`, \`duration_sec\`, \`deleted_at\`, \`created_at\`, \`updated_at\`)
SELECT
	\`id\`,
	\`gym_id\`,
	CASE
		WHEN \`status\` = 'completed' THEN 'completed'
		ELSE 'active'
	END,
	\`started_at\`,
	\`completed_at\`,
	\`duration_sec\`,
	\`deleted_at\`,
	\`created_at\`,
	\`updated_at\`
FROM \`sessions\`;--> statement-breakpoint
DROP TABLE \`sessions\`;--> statement-breakpoint
ALTER TABLE \`__new_sessions\` RENAME TO \`sessions\`;--> statement-breakpoint
CREATE INDEX \`sessions_status_idx\` ON \`sessions\` (\`status\`);--> statement-breakpoint
CREATE INDEX \`sessions_completed_at_idx\` ON \`sessions\` (\`completed_at\`);--> statement-breakpoint
CREATE INDEX \`sessions_deleted_at_idx\` ON \`sessions\` (\`deleted_at\`);--> statement-breakpoint
PRAGMA foreign_keys=ON;`,
    m0005: `ALTER TABLE \`exercise_definitions\` ADD \`deleted_at\` integer;--> statement-breakpoint
CREATE INDEX \`exercise_definitions_deleted_at_idx\` ON \`exercise_definitions\` (\`deleted_at\`);`,
    m0006: `CREATE TABLE \`exercise_tag_definitions\` (
	\`id\` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	\`exercise_definition_id\` text NOT NULL,
	\`name\` text NOT NULL,
	\`normalized_name\` text NOT NULL,
	\`deleted_at\` integer,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (\`exercise_definition_id\`) REFERENCES \`exercise_definitions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "exercise_tag_definitions_name_non_empty" CHECK("exercise_tag_definitions"."name" <> ''),
	CONSTRAINT "exercise_tag_definitions_normalized_name_non_empty" CHECK("exercise_tag_definitions"."normalized_name" <> '')
);
--> statement-breakpoint
CREATE INDEX \`exercise_tag_definitions_exercise_definition_id_idx\` ON \`exercise_tag_definitions\` (\`exercise_definition_id\`);--> statement-breakpoint
CREATE INDEX \`exercise_tag_definitions_deleted_at_idx\` ON \`exercise_tag_definitions\` (\`deleted_at\`);--> statement-breakpoint
CREATE UNIQUE INDEX \`exercise_tag_definitions_exercise_id_normalized_name_unique\` ON \`exercise_tag_definitions\` (\`exercise_definition_id\`,\`normalized_name\`);--> statement-breakpoint
CREATE TABLE \`session_exercise_tags\` (
	\`id\` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	\`session_exercise_id\` text NOT NULL,
	\`exercise_tag_definition_id\` text NOT NULL,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (\`session_exercise_id\`) REFERENCES \`session_exercises\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`exercise_tag_definition_id\`) REFERENCES \`exercise_tag_definitions\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX \`session_exercise_tags_session_exercise_id_idx\` ON \`session_exercise_tags\` (\`session_exercise_id\`);--> statement-breakpoint
CREATE INDEX \`session_exercise_tags_exercise_tag_definition_id_idx\` ON \`session_exercise_tags\` (\`exercise_tag_definition_id\`);--> statement-breakpoint
CREATE UNIQUE INDEX \`session_exercise_tags_session_exercise_id_tag_definition_unique\` ON \`session_exercise_tags\` (\`session_exercise_id\`,\`exercise_tag_definition_id\`);--> statement-breakpoint
ALTER TABLE \`session_exercises\` ADD \`exercise_definition_id\` text REFERENCES exercise_definitions(id);--> statement-breakpoint
CREATE INDEX \`session_exercises_exercise_definition_id_idx\` ON \`session_exercises\` (\`exercise_definition_id\`);`,
    m0007: `CREATE TABLE \`sync_delivery_state\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`device_id\` text NOT NULL,
	\`next_sequence_in_device\` integer DEFAULT 1 NOT NULL,
	\`consecutive_failures\` integer DEFAULT 0 NOT NULL,
	\`retry_blocked\` integer DEFAULT 0 NOT NULL,
	\`next_attempt_at\` integer,
	\`last_attempt_at\` integer,
	\`last_success_at\` integer,
	\`last_error_message\` text,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "sync_delivery_state_next_sequence_positive" CHECK("sync_delivery_state"."next_sequence_in_device" >= 1),
	CONSTRAINT "sync_delivery_state_consecutive_failures_non_negative" CHECK("sync_delivery_state"."consecutive_failures" >= 0),
	CONSTRAINT "sync_delivery_state_retry_blocked_boolean_guard" CHECK("sync_delivery_state"."retry_blocked" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE \`sync_outbox_events\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`event_id\` text NOT NULL,
	\`sequence_in_device\` integer NOT NULL,
	\`occurred_at\` integer NOT NULL,
	\`entity_type\` text NOT NULL,
	\`entity_id\` text NOT NULL,
	\`event_type\` text NOT NULL,
	\`payload_json\` text NOT NULL,
	\`schema_version\` integer DEFAULT 1 NOT NULL,
	\`trace_id\` text,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "sync_outbox_events_sequence_in_device_positive" CHECK("sync_outbox_events"."sequence_in_device" >= 1),
	CONSTRAINT "sync_outbox_events_payload_json_non_empty" CHECK("sync_outbox_events"."payload_json" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`sync_outbox_events_event_id_unique\` ON \`sync_outbox_events\` (\`event_id\`);--> statement-breakpoint
CREATE UNIQUE INDEX \`sync_outbox_events_sequence_in_device_unique\` ON \`sync_outbox_events\` (\`sequence_in_device\`);--> statement-breakpoint
CREATE INDEX \`sync_outbox_events_created_at_idx\` ON \`sync_outbox_events\` (\`created_at\`);`,
    m0008: `CREATE TABLE \`sync_runtime_state\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`is_enabled\` integer DEFAULT 0 NOT NULL,
	\`bootstrap_user_id\` text,
	\`bootstrap_completed_at\` integer,
	\`last_bootstrap_error\` text,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "sync_runtime_state_is_enabled_boolean_guard" CHECK("sync_runtime_state"."is_enabled" in (0, 1))
);`,
    m0009: `ALTER TABLE \`exercise_sets\` ADD \`set_type\` text;`,
    m0010: `ALTER TABLE \`sync_runtime_state\` ADD \`last_bootstrap_attempt_at\` integer;`,
    m0011: `DROP INDEX IF EXISTS \`gyms_origin_scope_id_idx\`;--> statement-breakpoint
ALTER TABLE \`gyms\` DROP COLUMN \`origin_scope_id\`;--> statement-breakpoint
ALTER TABLE \`gyms\` DROP COLUMN \`origin_source_id\`;--> statement-breakpoint
ALTER TABLE \`session_exercises\` DROP COLUMN \`origin_scope_id\`;--> statement-breakpoint
ALTER TABLE \`session_exercises\` DROP COLUMN \`origin_source_id\`;`,
    m0012: `ALTER TABLE \`sync_runtime_state\` ADD \`seeds_applied_at\` integer;`,
    m0013: `PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE \`__new_gyms\` (
	\`id\` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	\`name\` text NOT NULL,
	\`latitude\` real,
	\`longitude\` real,
	\`coordinate_accuracy_m\` real,
	\`coordinates_updated_at\` integer,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "gyms_latitude_range" CHECK("__new_gyms"."latitude" is null or ("__new_gyms"."latitude" >= -90 and "__new_gyms"."latitude" <= 90)),
	CONSTRAINT "gyms_longitude_range" CHECK("__new_gyms"."longitude" is null or ("__new_gyms"."longitude" >= -180 and "__new_gyms"."longitude" <= 180)),
	CONSTRAINT "gyms_coordinate_accuracy_non_negative" CHECK("__new_gyms"."coordinate_accuracy_m" is null or "__new_gyms"."coordinate_accuracy_m" >= 0),
	CONSTRAINT "gyms_coordinates_updated_at_non_negative" CHECK("__new_gyms"."coordinates_updated_at" is null or "__new_gyms"."coordinates_updated_at" >= 0),
	CONSTRAINT "gyms_coordinate_shape" CHECK((
        "__new_gyms"."latitude" is null
        and "__new_gyms"."longitude" is null
        and "__new_gyms"."coordinate_accuracy_m" is null
        and "__new_gyms"."coordinates_updated_at" is null
      ) or (
        "__new_gyms"."latitude" is not null
        and "__new_gyms"."longitude" is not null
        and "__new_gyms"."coordinate_accuracy_m" is not null
        and "__new_gyms"."coordinates_updated_at" is not null
      ))
);
--> statement-breakpoint
INSERT INTO \`__new_gyms\`("id", "name", "latitude", "longitude", "coordinate_accuracy_m", "coordinates_updated_at", "created_at", "updated_at") SELECT "id", "name", null, null, null, null, "created_at", "updated_at" FROM \`gyms\`;--> statement-breakpoint
DROP TABLE \`gyms\`;--> statement-breakpoint
ALTER TABLE \`__new_gyms\` RENAME TO \`gyms\`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX \`gyms_name_idx\` ON \`gyms\` (\`name\`);`,
    m0014: `DROP TABLE IF EXISTS \`sync_outbox_events\`;--> statement-breakpoint
DROP TABLE IF EXISTS \`sync_delivery_state\`;`,
  },
};
