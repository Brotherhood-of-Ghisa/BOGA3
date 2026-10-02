import Database from 'better-sqlite3';

import { generatedMigrationBundle } from '@/drizzle/migrations.generated';
import { __resetClockForTests, type Transaction } from '@/src/data/clock';
import {
  bodyWeightMeasurements,
  exerciseDefinitions,
  sessions,
  userSettings,
} from '@/src/data/schema';
import { createSessionDraftRepository } from '@/src/data/session-drafts';
import { applyPullPage, entityToWire } from '@/src/sync/cycle';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
jest.mock('@/src/logging/logEvent', () => ({ logEvent: jest.fn() }));

beforeEach(() => {
  __resetClockForTests();
  mockFixture = createInMemoryDatabase();
});
afterEach(() => mockFixture.close());

it('migrates populated local data to the final kg-only schema without changing identities or row clocks', () => {
  const client = new Database(':memory:');
  const apply = (idx: number) => {
    const sql = (generatedMigrationBundle.migrations as Record<string, string>)[`m${String(idx).padStart(4, '0')}`];
    for (const statement of sql.split('--> statement-breakpoint')) if (statement.trim()) client.exec(statement);
  };
  try {
    client.pragma('foreign_keys = ON');
    for (let idx = 0; idx < 10; idx += 1) apply(idx);
    client.exec(`
      INSERT INTO exercise_definitions
        (id,name,load_input_mode,bodyweight_coefficient,movement_standard,loading_method,local_dirty,local_updated_at_ms)
      VALUES ('def','Pull-Up','per_side_load',0.7,'strict','belt',1,101);
      INSERT INTO sessions (id,status,started_at,local_dirty,local_updated_at_ms)
      VALUES ('session','completed',1000,1,102);
      INSERT INTO session_exercises (id,session_id,exercise_definition_id,name,order_index)
      VALUES ('exercise','session','def','Pull-Up',0);
      INSERT INTO exercise_sets
        (id,session_exercise_id,order_index,weight_value,reps_value,weight_unit,external_load_mode,
         planned_weight_value,planned_weight_unit,planned_external_load_mode,local_dirty,local_updated_at_ms)
      VALUES ('set','exercise',0,'22','8','lb','added','11','lb','added',1,103);
      INSERT INTO body_weight_measurements
        (id,weight_value,weight_unit,weight_kg,measured_at,local_dirty,local_updated_at_ms)
      VALUES ('reading','176','lb',79.83225712,500,1,104);
    `);

    apply(10);

    expect(client.prepare('SELECT id,name,load_input_mode,bodyweight_contribution,local_dirty,local_updated_at_ms FROM exercise_definitions').get())
      .toEqual({ id: 'def', name: 'Pull-Up', load_input_mode: 'per_side_load', bodyweight_contribution: 0.7,
        local_dirty: 1, local_updated_at_ms: 101 });
    const migratedSet = client.prepare('SELECT id,weight_value,reps_value,planned_weight_value,local_dirty,local_updated_at_ms FROM exercise_sets').get() as {
      weight_value: string; planned_weight_value: string;
    };
    expect(migratedSet).toMatchObject({ id: 'set', reps_value: '8', local_dirty: 1, local_updated_at_ms: 103 });
    expect(Number(migratedSet.weight_value)).toBeCloseTo(22 * 0.45359237, 10);
    expect(Number(migratedSet.planned_weight_value)).toBeCloseTo(11 * 0.45359237, 10);
    expect(client.prepare('SELECT id,weight_kg,measured_at,local_dirty,local_updated_at_ms FROM body_weight_measurements').get())
      .toEqual({ id: 'reading', weight_kg: 79.83225712, measured_at: 500,
        local_dirty: 1, local_updated_at_ms: 104 });
    expect(client.prepare('SELECT id,bodyweight_calculations_enabled FROM user_settings').all()).toEqual([]);
    const columns = (table: string) => (client.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
      .map(column => column.name);
    expect(columns('exercise_definitions')).toEqual(expect.arrayContaining(['bodyweight_contribution']));
    expect(columns('exercise_definitions')).not.toEqual(expect.arrayContaining([
      'bodyweight_coefficient', 'movement_standard', 'loading_method', 'local_bodyweight_metadata_known',
    ]));
    expect(columns('exercise_sets')).not.toEqual(expect.arrayContaining([
      'weight_unit', 'external_load_mode', 'planned_weight_unit', 'planned_external_load_mode',
      'local_bodyweight_metadata_known',
    ]));
    expect(columns('body_weight_measurements')).not.toEqual(expect.arrayContaining(['weight_value', 'weight_unit']));
    expect(columns('sessions').filter(column => column.includes('body_weight') || column.includes('bodyweight'))).toEqual([]);
    expect(client.pragma('foreign_key_check')).toEqual([]);
  } finally {
    client.close();
  }
});

const seedGraph = async () => {
  const db = mockFixture.database;
  db.insert(userSettings).values({ id: 'settings', bodyweightCalculationsEnabled: true }).run();
  db.insert(bodyWeightMeasurements).values({
    id: 'reading', weightKg: 80, measuredAt: new Date(1000),
  }).run();
  db.insert(exerciseDefinitions).values({ id: 'def', name: 'Pull-Up', bodyweightContribution: 1 }).run();
  const repository = createSessionDraftRepository();
  const saved = await repository.persistDraftSnapshot({
    gymId: null,
    startedAt: new Date(2000),
    exercises: [{
      id: 'exercise',
      exerciseDefinitionId: 'def',
      name: 'Pull-Up',
      sets: [{
        id: 'set',
        weightValue: '20',
        repsValue: '8',
        plannedWeightValue: '10',
        plannedRepsValue: '10',
        performanceStatus: null,
      }],
    }],
  });
  return { repository, sessionId: saved.sessionId };
};

it('derives one read-time context and retains kg Weight values through autosave, completion and reopen', async () => {
  const { repository, sessionId } = await seedGraph();
  await repository.persistDraftSnapshot({
    sessionId,
    gymId: null,
    startedAt: new Date(2000),
    exercises: [{
      id: 'exercise',
      exerciseDefinitionId: 'def',
      name: 'Pull-Up',
      sets: [{ id: 'set', weightValue: '20', repsValue: '9', performanceStatus: null }],
    }],
  });
  await repository.completeSession(sessionId, { completedAt: new Date(62000) });
  await repository.reopenCompletedSession(sessionId);
  const snapshot = await repository.loadSessionSnapshotById(sessionId);
  expect(snapshot).toMatchObject({
    bodyWeightKg: 80,
    bodyWeightSource: 'reading',
    bodyWeightMeasurementId: 'reading',
    bodyWeightMeasuredAt: new Date(1000),
  });
  expect(snapshot?.exercises[0].sets[0]).toMatchObject({
    weightValue: '20', repsValue: '9', plannedWeightValue: '10', plannedRepsValue: '10',
  });
});

it('re-resolves changed and deleted readings without persisting context on the session', async () => {
  const { repository, sessionId } = await seedGraph();
  const db = mockFixture.database;
  const before = db.select().from(sessions).get();
  db.update(bodyWeightMeasurements).set({ weightKg: 90 }).run();
  expect((await repository.loadSessionSnapshotById(sessionId))?.bodyWeightKg).toBe(90);
  db.update(bodyWeightMeasurements).set({ deletedAt: new Date(3000) }).run();
  expect((await repository.loadSessionSnapshotById(sessionId))?.bodyWeightKg).toBeNull();
  db.delete(bodyWeightMeasurements).run();
  expect((await repository.loadSessionSnapshotById(sessionId))?.bodyWeightKg).toBeNull();
  expect(db.select().from(sessions).get()).toEqual(before);
  expect(entityToWire(before!, 'sessions').fields).not.toHaveProperty('body_weight_kg');
});

it('copies raw performed Weight into a new plan and resolves the target date independently', async () => {
  const { repository, sessionId } = await seedGraph();
  await repository.completeSession(sessionId, { completedAt: new Date(62000) });
  mockFixture.database.insert(bodyWeightMeasurements).values({
    id: 'current-reading', weightKg: 85, measuredAt: new Date(90000),
  }).run();
  const target = await repository.appendCompletedSessionAsPlanned(sessionId, { now: new Date(100000) });
  const snapshot = await repository.loadSessionSnapshotById(target.sessionId);
  expect(snapshot).toMatchObject({ bodyWeightKg: 85, bodyWeightMeasurementId: 'current-reading' });
  expect(snapshot?.exercises[0].sets[0]).toMatchObject({
    weightValue: '', repsValue: '', plannedWeightValue: '20', performanceStatus: 'planned',
  });
});

it('round-trips a clean kg reading through sync and applies tombstone/undelete by LWW', () => {
  const db = mockFixture.database;
  const original = {
    id: 'reading',
    weightKg: 79.8,
    measuredAt: new Date(1000),
    createdAt: new Date(1000),
    updatedAt: new Date(1000),
    deletedAt: null,
    localDirty: true,
    localUpdatedAtMs: 100,
  };
  const wire = entityToWire(original, 'body_weight_measurements');
  expect(wire.fields).toMatchObject({ weight_kg: 79.8, measured_at: 1000 });
  expect(Object.keys(wire.fields).sort()).toEqual([
    'created_at', 'deleted_at', 'measured_at', 'updated_at', 'weight_kg',
  ]);
  const apply = () => db.transaction(tx => applyPullPage(tx as Transaction, [wire], 'body_weight_measurements'));
  expect(apply()).toBe(1);
  expect(db.select().from(bodyWeightMeasurements).get()).toMatchObject({ ...original, localDirty: false });
  db.update(bodyWeightMeasurements).set({ weightKg: 81, localDirty: true, localUpdatedAtMs: 200 }).run();
  expect(apply()).toBe(0);
  expect(db.select().from(bodyWeightMeasurements).get()).toMatchObject({ weightKg: 81, localDirty: true });
  wire.client_updated_at_ms = 300;
  wire.fields.deleted_at = 300;
  expect(apply()).toBe(1);
  expect(db.select().from(bodyWeightMeasurements).get()?.deletedAt).toEqual(new Date(300));
  wire.client_updated_at_ms = 400;
  wire.fields.deleted_at = null;
  expect(apply()).toBe(1);
  expect(db.select().from(bodyWeightMeasurements).get()).toMatchObject({ deletedAt: null, localDirty: false });
});

it('puts only the final preference and contribution fields on the sync wire', () => {
  const settings = entityToWire({
    id: 'settings', bodyweightCalculationsEnabled: true, deletedAt: null,
    createdAt: new Date(1000), updatedAt: new Date(1000), localDirty: true, localUpdatedAtMs: 100,
  }, 'user_settings');
  expect(settings.fields).toEqual({
    bodyweight_calculations_enabled: true, deleted_at: null, created_at: 1000, updated_at: 1000,
  });
  const definition = entityToWire({
    id: 'definition', name: 'Pull-Up', loadInputMode: 'total_load', bodyweightContribution: 0.7,
    deletedAt: null, createdAt: new Date(1000), updatedAt: new Date(1000),
    localDirty: true, localUpdatedAtMs: 100,
  }, 'exercise_definitions');
  expect(definition.fields).toMatchObject({ bodyweight_contribution: 0.7, load_input_mode: 'total_load' });
  expect(Object.keys(definition.fields).sort()).toEqual([
    'bodyweight_contribution', 'created_at', 'deleted_at', 'load_input_mode', 'name', 'updated_at',
  ]);
});
