import * as schema from '@/src/data/schema';
import { localRuntimeMigrations } from '@/src/data/migrations';

describe('domain schema and runtime migrations', () => {
  it('exports domain tables and no longer exports smoke table from schema index', () => {
    expect(schema).toMatchObject({
      muscleGroups: expect.any(Object),
      exerciseDefinitions: expect.any(Object),
      exerciseTagDefinitions: expect.any(Object),
      exerciseMuscleMappings: expect.any(Object),
      gyms: expect.any(Object),
      sessionExerciseTags: expect.any(Object),
      sessions: expect.any(Object),
      sessionExercises: expect.any(Object),
      exerciseSets: expect.any(Object),
    });
    expect(schema).not.toHaveProperty('smokeRecords');
  });

  it('includes session lifecycle, taxonomy tables, and deterministic ordering constraints in runtime SQL', () => {
    const migrationSql = Object.values(localRuntimeMigrations.migrations).join('\n');
    // The migration history is squashed to a single baseline, so every entity
    // table is created by `m0000` rather than spread across fifteen incremental
    // migrations. The lifecycle constraints that used to live in m0004 are baked
    // straight into the `sessions` CREATE TABLE.
    const baselineMigration = localRuntimeMigrations.migrations.m0000;

    expect(migrationSql).toContain('CREATE TABLE `muscle_groups`');
    expect(migrationSql).toContain('CREATE TABLE `exercise_definitions`');
    expect(migrationSql).toContain('CREATE TABLE `exercise_tag_definitions`');
    expect(migrationSql).toContain('CREATE TABLE `exercise_muscle_mappings`');

    expect(migrationSql).toContain('CREATE TABLE `gyms`');
    expect(migrationSql).toContain('CREATE TABLE `sessions`');
    expect(migrationSql).toContain('CREATE TABLE `session_exercises`');
    expect(migrationSql).toContain('CREATE TABLE `session_exercise_tags`');
    expect(migrationSql).toContain('CREATE TABLE `exercise_sets`');

    expect(migrationSql).toContain('`started_at` integer NOT NULL');
    expect(migrationSql).toContain('`completed_at` integer');
    expect(migrationSql).toContain('`duration_sec` integer');
    expect(migrationSql).toContain('`deleted_at` integer');
    expect(baselineMigration).toContain("`status` text DEFAULT 'active' NOT NULL");
    expect(baselineMigration).toContain(
      'CONSTRAINT "sessions_status_guard" CHECK("sessions"."status" in (\'active\', \'completed\'))'
    );
    expect(baselineMigration).toContain(
      'CONSTRAINT "sessions_duration_non_negative" CHECK("sessions"."duration_sec" is null or "sessions"."duration_sec" >= 0)'
    );
    // The `exercise_sets.set_type` column lives directly in the baseline
    // CREATE TABLE; the standalone `ALTER TABLE ... ADD set_type` migration
    // from the pre-squash history is no longer emitted.
    expect(baselineMigration).toContain('`set_type` text');

    expect(migrationSql).toContain('`is_editable` integer DEFAULT 0 NOT NULL');
    expect(migrationSql).toContain('`weight` real NOT NULL');

    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX `session_exercises_session_id_order_index_unique` ON `session_exercises` (`session_id`,`order_index`)'
    );
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX `exercise_sets_session_exercise_id_order_index_unique` ON `exercise_sets` (`session_exercise_id`,`order_index`)'
    );
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX `exercise_muscle_mappings_exercise_id_muscle_group_id_unique` ON `exercise_muscle_mappings` (`exercise_definition_id`,`muscle_group_id`)'
    );
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX `exercise_tag_definitions_exercise_id_normalized_name_unique` ON `exercise_tag_definitions` (`exercise_definition_id`,`normalized_name`)'
    );
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX `session_exercise_tags_session_exercise_id_tag_definition_unique` ON `session_exercise_tags` (`session_exercise_id`,`exercise_tag_definition_id`)'
    );
    expect(migrationSql).toContain('CREATE INDEX `sessions_deleted_at_idx` ON `sessions` (`deleted_at`)');
    expect(migrationSql).toContain('CREATE INDEX `session_exercises_exercise_definition_id_idx` ON `session_exercises` (`exercise_definition_id`)');
    expect(migrationSql).toContain(
      'CONSTRAINT "exercise_muscle_mappings_weight_positive" CHECK("exercise_muscle_mappings"."weight" > 0)'
    );
    // `muscle_groups` is a normal per-user synced entity: it carries the
    // local-only sync bookkeeping columns and a generated `id` default, and it
    // keeps only generic data guards. The old "must stay non-editable" CHECK is
    // gone so the taxonomy can round-trip on the wire like every other entity.
    expect(migrationSql).toContain(
      '`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL'
    );
    expect(migrationSql).toContain(
      'CONSTRAINT "muscle_groups_sort_order_non_negative" CHECK("muscle_groups"."sort_order" >= 0)'
    );
    expect(migrationSql).toContain(
      'CONSTRAINT "muscle_groups_is_editable_boolean_guard" CHECK("muscle_groups"."is_editable" in (0, 1))'
    );
    expect(migrationSql).not.toContain('muscle_groups_non_editable_guard');
    expect(migrationSql).toContain(
      'CONSTRAINT "exercise_definitions_name_non_empty" CHECK("exercise_definitions"."name" <> \'\')'
    );
    expect(migrationSql).toContain(
      'CONSTRAINT "exercise_tag_definitions_name_non_empty" CHECK("exercise_tag_definitions"."name" <> \'\')'
    );
    expect(migrationSql).toContain(
      'CONSTRAINT "exercise_tag_definitions_normalized_name_non_empty" CHECK("exercise_tag_definitions"."normalized_name" <> \'\')'
    );
    expect(migrationSql).toContain('CREATE INDEX `exercise_definitions_deleted_at_idx` ON `exercise_definitions` (`deleted_at`)');

    expect(migrationSql).not.toContain('CREATE INDEX `exercise_definitions_origin_scope_id_idx`');
    expect(migrationSql).not.toContain('CREATE INDEX `exercise_definitions_origin_source_id_idx`');
    expect(migrationSql).not.toContain('CREATE UNIQUE INDEX `exercise_definitions_origin_identity_unique`');
    expect(migrationSql).not.toContain('CONSTRAINT "exercise_definitions_origin_scope_id_non_empty"');
    expect(migrationSql).not.toContain('CONSTRAINT "exercise_definitions_origin_source_id_non_empty"');
    expect(migrationSql).not.toContain('CONSTRAINT "exercise_definitions_origin_source_key_non_empty"');
    expect(migrationSql).not.toContain('`is_user_editable` integer');

    expect(migrationSql).not.toContain('`name` text NOT NULL UNIQUE');

    // Squash invariants: the v1 sync tables never get created in the
    // baseline, so the m0014 `DROP TABLE` follow-up is gone too. The
    // baseline also does not need the m0004-era `__new_sessions` shadow
    // table or the `__new_gyms` rebuild from the original m0013 — those
    // were collapsed straight into the final CREATE TABLE.
    expect(migrationSql).not.toContain('CREATE TABLE `sync_outbox_events`');
    expect(migrationSql).not.toContain('CREATE TABLE `sync_delivery_state`');
    expect(migrationSql).not.toContain('DROP TABLE IF EXISTS `sync_outbox_events`');
    expect(migrationSql).not.toContain('DROP TABLE IF EXISTS `sync_delivery_state`');
    expect(migrationSql).not.toContain('CREATE TABLE `__new_sessions`');
    expect(migrationSql).not.toContain('CREATE TABLE `__new_gyms`');
  });

  it('keeps the squashed v2 baseline as m0000 and appends feature migrations after it', () => {
    // The history was squashed to a single v2 baseline (`m0000`); forward feature
    // migrations append after it. The first follow-up is the local sync
    // quarantine table; planned set targets append after that.
    expect(localRuntimeMigrations.journal.entries).toHaveLength(4);
    expect(localRuntimeMigrations.journal.entries[0]).toMatchObject({
      idx: 0,
      tag: expect.stringMatching(/^0000_/),
    });
    expect(localRuntimeMigrations.journal.entries[1]).toMatchObject({
      idx: 1,
      tag: expect.stringMatching(/^0001_/),
    });
    expect(localRuntimeMigrations.journal.entries[2]).toMatchObject({
      idx: 2,
      tag: expect.stringMatching(/^0002_/),
    });
    expect(localRuntimeMigrations.journal.entries[3]).toMatchObject({
      idx: 3,
      tag: expect.stringMatching(/^0003_/),
    });
    expect(Object.keys(localRuntimeMigrations.migrations)).toEqual(['m0000', 'm0001', 'm0002', 'm0003']);
  });

  it('creates the local sync quarantine table in the m0001 follow-up migration', () => {
    const quarantineMigration = localRuntimeMigrations.migrations.m0001;
    expect(quarantineMigration).toContain('CREATE TABLE `sync_quarantine`');
    expect(quarantineMigration).toContain('PRIMARY KEY(`entity_type`, `entity_id`)');
    expect(quarantineMigration).toContain('`error_code` text NOT NULL');
    expect(quarantineMigration).toContain('`occurrence_count` integer DEFAULT 1 NOT NULL');
    // The quarantine table is FK-free local bookkeeping over possibly-orphaned
    // rows — it must declare no foreign keys.
    expect(quarantineMigration).not.toContain('FOREIGN KEY');
  });

  it('adds planned-vs-performed set columns in the m0002 follow-up migration', () => {
    const plannedSetMigration = localRuntimeMigrations.migrations.m0002;
    expect(plannedSetMigration).toContain('ADD `planned_weight_value` text');
    expect(plannedSetMigration).toContain('ADD `planned_reps_value` text');
    expect(plannedSetMigration).toContain('ADD `planned_set_type` text');
    expect(plannedSetMigration).toContain('ADD `performance_status` text');
  });

  it('adds constrained load semantics in the m0003 follow-up migration', () => {
    const loadModeMigration = localRuntimeMigrations.migrations.m0003;
    expect(loadModeMigration).toContain('`load_input_mode` text DEFAULT \'total_load\' NOT NULL');
    expect(loadModeMigration).toContain('exercise_definitions_load_input_mode_valid');
  });
});

describe('muscle_groups lives in the squashed baseline and adds no migration of its own', () => {
  // The synced-entity muscle_groups shape ships inside the squashed baseline
  // (the `0000_living_bucky` baseline), NOT as a follow-up incremental
  // migration. The follow-up that DOES exist on the journal is the unrelated
  // local sync-quarantine table — that one is out of scope here.
  const BASELINE_TAG = '0000_living_bucky';

  it('keeps the squashed baseline tagged 0000_living_bucky', () => {
    const baselineEntry = localRuntimeMigrations.journal.entries.find((entry) => entry.idx === 0);
    expect(baselineEntry?.tag).toBe(BASELINE_TAG);
  });

  it('carries the synced-entity muscle_groups shape in the baseline without the non-editable guard', () => {
    const baselineMigration = localRuntimeMigrations.migrations.m0000;

    // The table is created by the baseline itself.
    expect(baselineMigration).toContain('CREATE TABLE `muscle_groups`');
    // It carries the generated id default and the two local-only sync columns,
    // so it round-trips on the wire like every other synced entity.
    expect(baselineMigration).toContain(
      '`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL'
    );
    expect(baselineMigration).toContain('`local_dirty` integer DEFAULT false NOT NULL');
    expect(baselineMigration).toContain('`local_updated_at_ms` integer DEFAULT 0 NOT NULL');
    expect(baselineMigration).toContain('`deleted_at` integer');
    // The only data guards left are generic; the "must stay non-editable" CHECK
    // that blocked the wire round-trip is gone.
    expect(baselineMigration).toContain(
      'CONSTRAINT "muscle_groups_sort_order_non_negative" CHECK("muscle_groups"."sort_order" >= 0)'
    );
    expect(baselineMigration).toContain(
      'CONSTRAINT "muscle_groups_is_editable_boolean_guard" CHECK("muscle_groups"."is_editable" in (0, 1))'
    );
    expect(baselineMigration).not.toContain('muscle_groups_non_editable_guard');
  });

  it('introduces no muscle_groups-specific incremental migration after the baseline', () => {
    // Every follow-up migration after the baseline (idx > 0) must NOT create,
    // alter, or otherwise carry a muscle_groups DDL statement — the taxonomy's
    // whole shape lives in the baseline. (The journal legitimately carries the
    // unrelated sync-quarantine follow-up; that is the only post-baseline entry
    // and it touches no entity table.)
    const followUps = localRuntimeMigrations.journal.entries
      .filter((entry) => entry.idx > 0)
      .map((entry) => `m${String(entry.idx).padStart(4, '0')}`);

    for (const key of followUps) {
      const sql = (localRuntimeMigrations.migrations as Record<string, string | undefined>)[key] ?? '';
      expect(sql).not.toContain('`muscle_groups`');
      expect(sql).not.toContain('muscle_groups');
    }
  });
});
