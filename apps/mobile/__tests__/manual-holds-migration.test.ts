import Database from 'better-sqlite3';

import { generatedMigrationBundle } from '@/drizzle/migrations.generated';
import { applyMigrationBundle } from './helpers/in-memory-db';

it('upgrades populated repetition history without changing provenance, clocks or facts triggers', () => {
  const client = new Database(':memory:');
  try {
    const entries = generatedMigrationBundle.journal.entries;
    applyMigrationBundle(client, {
      journal: { entries: entries.slice(0, -1) }, migrations: generatedMigrationBundle.migrations,
    });
    client.pragma('foreign_keys = ON');
    client.exec(`
      INSERT INTO exercise_definitions(id, name) VALUES ('plank', 'Plank');
      INSERT INTO session_plans(id, title) VALUES ('plan', 'Plan');
      INSERT INTO session_plan_exercises(id, session_plan_id, exercise_definition_id, order_index, name)
        VALUES ('block', 'plan', 'plank', 0, 'Plank');
      INSERT INTO session_plan_sets(id, session_plan_exercise_id, order_index, target_reps, local_dirty, local_updated_at_ms)
        VALUES ('target', 'block', 0, 12, 1, 123);
      INSERT INTO sessions(id, status, started_at, completed_at) VALUES ('session', 'completed', 1000, 2000);
      INSERT INTO session_exercises(id, session_id, exercise_definition_id, order_index, name, source_plan_exercise_id)
        VALUES ('card', 'session', 'plank', 0, 'Plank', 'block');
      INSERT INTO exercise_sets(id, session_exercise_id, source_plan_set_id, order_index, reps_value, weight_value,
        set_type, local_dirty, local_updated_at_ms) VALUES ('set', 'card', 'target', 0, '12', '0', 'rir_3', 1, 456);
    `);
    const beforeSet = client.prepare('SELECT * FROM exercise_sets').get();
    const beforeTarget = client.prepare('SELECT * FROM session_plan_sets').get();
    const beforeTriggers = client.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
    client.transaction(() => applyMigrationBundle(client, {
      journal: { entries: entries.slice(-1) }, migrations: generatedMigrationBundle.migrations,
    }))();

    expect(client.prepare('SELECT * FROM exercise_sets').get()).toEqual({
      ...beforeSet!, recording_mode: 'reps', duration_sec: null,
    });
    expect(client.prepare('SELECT * FROM session_plan_sets').get()).toEqual({
      ...beforeTarget!, recording_mode: 'reps', target_duration_sec: null,
    });
    expect(client.prepare('SELECT recording_mode FROM exercise_definitions').get()).toEqual({ recording_mode: 'reps' });
    expect(client.pragma('foreign_key_check')).toEqual([]);
    expect(client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(client.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all()).toEqual(beforeTriggers);

    client.exec("DELETE FROM exercise_session_facts_stale; UPDATE exercise_sets SET recording_mode = 'hold', reps_value = '', duration_sec = 45");
    expect(client.prepare('SELECT * FROM exercise_session_facts_stale').all()).toEqual([{ exercise_definition_id: 'plank' }]);
    client.exec('DELETE FROM exercise_session_facts_stale; UPDATE exercise_sets SET duration_sec = 38');
    expect(client.prepare('SELECT * FROM exercise_session_facts_stale').all()).toEqual([{ exercise_definition_id: 'plank' }]);
    client.exec("UPDATE session_plan_sets SET recording_mode = 'hold', target_reps = NULL, target_duration_sec = 45");
    expect(() => client.exec('UPDATE session_plan_sets SET target_reps = 12')).toThrow();
    expect(() => client.exec('UPDATE session_plan_sets SET target_duration_sec = NULL')).toThrow();
  } finally {
    client.close();
  }
});
