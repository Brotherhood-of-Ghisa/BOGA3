import Database from 'better-sqlite3';

import { generatedMigrationBundle } from '@/drizzle/migrations.generated';

const migrationSql = (idx: number): string => {
  const key = `m${String(idx).padStart(4, '0')}`;
  const sql = (generatedMigrationBundle.migrations as Record<string, string | undefined>)[key];

  if (sql === undefined) {
    throw new Error(`Missing bundled migration ${key}`);
  }

  return sql;
};

const applyMigration = (client: Database.Database, idx: number): void => {
  for (const rawStatement of migrationSql(idx).split('--> statement-breakpoint')) {
    const statement = rawStatement.trim();
    if (statement.length > 0) {
      client.exec(statement);
    }
  }
};

describe('load-input-mode local SQLite upgrade', () => {
  it('migrates an FK-enforced 0000–0002 database without losing its exercise graph', () => {
    const client = new Database(':memory:');

    try {
      client.pragma('foreign_keys = ON');
      client.transaction(() => {
        applyMigration(client, 0);
        applyMigration(client, 1);
        applyMigration(client, 2);
      })();

      client.exec(`
        INSERT INTO muscle_groups (id, display_name, family_name)
        VALUES ('muscle-1', 'Chest', 'Chest');

        INSERT INTO exercise_definitions (id, name)
        VALUES ('definition-1', 'Bench Press');

        INSERT INTO exercise_muscle_mappings (
          id,
          exercise_definition_id,
          muscle_group_id,
          weight,
          role
        )
        VALUES ('mapping-1', 'definition-1', 'muscle-1', 1, 'primary');

        INSERT INTO exercise_tag_definitions (
          id,
          exercise_definition_id,
          name,
          normalized_name
        )
        VALUES ('tag-1', 'definition-1', 'Barbell', 'barbell');

        INSERT INTO sessions (id, status, started_at)
        VALUES ('session-1', 'completed', 1000);

        INSERT INTO session_exercises (
          id,
          session_id,
          exercise_definition_id,
          order_index,
          name
        )
        VALUES ('session-exercise-1', 'session-1', 'definition-1', 0, 'Bench Press');

        INSERT INTO session_exercise_tags (
          id,
          session_exercise_id,
          exercise_tag_definition_id
        )
        VALUES ('session-tag-1', 'session-exercise-1', 'tag-1');

        INSERT INTO exercise_sets (
          id,
          session_exercise_id,
          order_index,
          weight_value,
          reps_value
        )
        VALUES ('set-1', 'session-exercise-1', 0, '100', '5');
      `);

      expect(
        (client.pragma('foreign_keys') as { foreign_keys: number }[])[0]?.foreign_keys
      ).toBe(1);

      expect(() =>
        client.transaction(() => {
          applyMigration(client, 3);
        })()
      ).not.toThrow();

      expect(
        client
          .prepare(
            `
              SELECT
                d.id AS definition_id,
                d.name,
                d.load_input_mode,
                m.id AS mapping_id,
                td.id AS tag_definition_id,
                se.id AS session_exercise_id,
                st.id AS session_tag_id,
                es.id AS set_id,
                es.weight_value,
                es.reps_value
              FROM exercise_definitions d
              JOIN exercise_muscle_mappings m
                ON m.exercise_definition_id = d.id
              JOIN exercise_tag_definitions td
                ON td.exercise_definition_id = d.id
              JOIN session_exercises se
                ON se.exercise_definition_id = d.id
              JOIN session_exercise_tags st
                ON st.session_exercise_id = se.id
                AND st.exercise_tag_definition_id = td.id
              JOIN exercise_sets es
                ON es.session_exercise_id = se.id
              WHERE d.id = 'definition-1'
            `
          )
          .get()
      ).toEqual({
        definition_id: 'definition-1',
        name: 'Bench Press',
        load_input_mode: 'total_load',
        mapping_id: 'mapping-1',
        tag_definition_id: 'tag-1',
        session_exercise_id: 'session-exercise-1',
        session_tag_id: 'session-tag-1',
        set_id: 'set-1',
        weight_value: '100',
        reps_value: '5',
      });

      expect(client.pragma('foreign_key_check')).toEqual([]);
      expect(() =>
        client
          .prepare(
            "UPDATE exercise_definitions SET load_input_mode = 'invalid' WHERE id = 'definition-1'"
          )
          .run()
      ).toThrow(/CHECK constraint failed: exercise_definitions_load_input_mode_valid/);
    } finally {
      client.close();
    }
  });
});
