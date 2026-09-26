import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { generatedMigrationBundle } from '@/drizzle/migrations.generated';
import { __resetClockForTests, type Transaction } from '@/src/data/clock';
import { bodyWeightMeasurements, exerciseDefinitions, exerciseSets, sessions } from '@/src/data/schema';
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

it('upgrades populated pre-M27 data, replaying only affected cursors without changing row clocks', () => {
  const client = new Database(':memory:');
  const apply = (idx: number) => {
    const key = `m${String(idx).padStart(4, '0')}`;
    const sql = (generatedMigrationBundle.migrations as Record<string, string>)[key];
    for (const statement of sql.split('--> statement-breakpoint')) if (statement.trim()) client.exec(statement);
  };
  try {
    client.pragma('foreign_keys = ON');
    for (let idx = 0; idx < 7; idx += 1) apply(idx);
    client.exec(`
      INSERT INTO sync_runtime_state (id, pull_cursor, bootstrap_completed_at) VALUES ('primary', '{"0":{"id":"old0"},"1":{"id":"old1"},"2":{"id":"keep2"},"3":{"id":"old3"}}', 1000);
      INSERT INTO exercise_definitions (id, name, load_input_mode) VALUES ('def', 'Pull-Up', 'per_side_load');
      INSERT INTO sessions (id, status, started_at) VALUES ('session', 'completed', 1000);
      INSERT INTO session_exercises (id, session_id, exercise_definition_id, name, order_index)
        VALUES ('exercise', 'session', 'def', 'Pull-Up', 0);
      INSERT INTO exercise_sets (id, session_exercise_id, order_index, weight_value, reps_value, planned_weight_value)
        VALUES ('set', 'exercise', 0, '80', '8', '85');
    `);
    const before = client.prepare('SELECT * FROM exercise_sets').get();
    const runtime = client.prepare('SELECT * FROM sync_runtime_state').get() as Record<string, unknown>;
    client.transaction(() => { apply(7); apply(8); })();
    expect(client.prepare('SELECT * FROM exercise_sets').get()).toMatchObject({
      ...before as object, weight_unit: 'kg', external_load_mode: null,
      planned_weight_unit: null, planned_external_load_mode: null, local_bodyweight_metadata_known: 0,
    });
    expect(client.prepare('SELECT * FROM exercise_definitions').get()).toMatchObject({
      name: 'Pull-Up', load_input_mode: 'per_side_load', bodyweight_coefficient: 0,
      movement_standard: null, loading_method: null,
    });
    expect(client.prepare('SELECT * FROM sessions').get()).toMatchObject({
      body_weight_kg: null, body_weight_source: null, body_weight_measurement_id: null,
      body_weight_measured_at: null,
    });
    expect(client.prepare('SELECT * FROM sync_runtime_state').get()).toEqual({ ...runtime, pull_cursor: '{"2":{"id":"keep2"}}' });
    expect(client.pragma('foreign_key_check')).toEqual([]);
  } finally { client.close(); }
});

const seedGraph = async () => {
  const db = mockFixture.database;
  db.insert(bodyWeightMeasurements).values({
    id: 'reading', weightValue: '80', weightUnit: 'kg', weightKg: 80, measuredAt: new Date(1000),
  }).run();
  db.insert(exerciseDefinitions).values({ id: 'def', name: 'Pull-Up', bodyweightCoefficient: 1 }).run();
  const repository = createSessionDraftRepository();
  const saved = await repository.persistDraftSnapshot({
    gymId: null, startedAt: new Date(2000), exercises: [{
      id: 'exercise', exerciseDefinitionId: 'def', name: 'Pull-Up', sets: [{
        id: 'set', weightValue: '20', repsValue: '8', weightUnit: 'lb', externalLoadMode: 'assistance',
        plannedWeightValue: '10', plannedRepsValue: '10', plannedWeightUnit: 'kg',
        plannedExternalLoadMode: 'added', performanceStatus: null,
      }],
    }],
  });
  db.update(sessions).set({ bodyWeightKg: 80, bodyWeightSource: 'reading',
    bodyWeightMeasurementId: 'reading', bodyWeightMeasuredAt: new Date(1000),
  }).where(eq(sessions.id, saved.sessionId)).run();
  return { repository, sessionId: saved.sessionId };
};

it('retains snapshot and actual/planned metadata through legacy autosave, complete and reopen', async () => {
  const { repository, sessionId } = await seedGraph();
  // Older callers omit the new keys while editing an unrelated field.
  await repository.persistDraftSnapshot({ sessionId, gymId: null, startedAt: new Date(2000), exercises: [{
    id: 'exercise', exerciseDefinitionId: 'def', name: 'Pull-Up', sets: [{
      id: 'set', weightValue: '20', repsValue: '9', performanceStatus: null,
    }],
  }] });
  await repository.completeSession(sessionId, { completedAt: new Date(62000) });
  await repository.reopenCompletedSession(sessionId);
  const snapshot = await repository.loadSessionSnapshotById(sessionId);
  expect(snapshot).toMatchObject({ bodyWeightKg: 80, bodyWeightSource: 'reading',
    bodyWeightMeasurementId: 'reading', bodyWeightMeasuredAt: new Date(1000),
  });
  expect(snapshot?.exercises[0].sets[0]).toMatchObject({ repsValue: '9', weightUnit: 'lb',
    externalLoadMode: 'assistance', plannedWeightUnit: 'kg', plannedExternalLoadMode: 'added',
  });
});

it('never refreshes a saved snapshot after its source is changed, tombstoned or physically deleted', async () => {
  const { repository, sessionId } = await seedGraph();
  const db = mockFixture.database;
  for (const change of [{ weightKg: 90 }, { deletedAt: new Date(3000) }]) {
    db.update(bodyWeightMeasurements).set(change).where(eq(bodyWeightMeasurements.id, 'reading')).run();
    expect((await repository.loadSessionSnapshotById(sessionId))?.bodyWeightKg).toBe(80);
  }
  db.delete(bodyWeightMeasurements).where(eq(bodyWeightMeasurements.id, 'reading')).run();
  expect(await repository.loadSessionSnapshotById(sessionId)).toMatchObject({
    bodyWeightKg: 80, bodyWeightMeasurementId: 'reading', bodyWeightMeasuredAt: new Date(1000),
  });
});

it('copies source actual units and mode into a plan without copying the old session weight', async () => {
  const { repository, sessionId } = await seedGraph();
  await repository.completeSession(sessionId, { completedAt: new Date(62000) });
  mockFixture.database.insert(bodyWeightMeasurements).values({
    id: 'current-reading', weightValue: '85', weightUnit: 'kg', weightKg: 85, measuredAt: new Date(90000),
  }).run();
  const target = await repository.appendCompletedSessionAsPlanned(sessionId, { now: new Date(100000) });
  const snapshot = await repository.loadSessionSnapshotById(target.sessionId);
  expect(snapshot).toMatchObject({ bodyWeightKg: 85, bodyWeightMeasurementId: 'current-reading' });
  expect(snapshot?.exercises[0].sets[0]).toMatchObject({ weightValue: '', repsValue: '',
    plannedWeightValue: '20', plannedWeightUnit: 'lb', plannedExternalLoadMode: 'assistance',
    externalLoadMode: null, performanceStatus: 'planned',
  });
});

it('can explicitly clear nullable mode metadata without turning legacy rows into added load', async () => {
  const { repository, sessionId } = await seedGraph();
  const snapshot = await repository.loadSessionSnapshotById(sessionId);
  if (!snapshot) throw new Error('Missing seeded graph');
  snapshot.exercises[0].sets[0].externalLoadMode = null;
  snapshot.exercises[0].sets[0].plannedExternalLoadMode = null;
  await repository.persistDraftSnapshot({ ...snapshot, status: 'active' });
  expect(mockFixture.database.select().from(exerciseSets).get()).toMatchObject({
    externalLoadMode: null, plannedExternalLoadMode: null, weightUnit: 'lb', plannedWeightUnit: 'kg',
  });
});

it('restores a reading through sync, keeps newer local changes, and applies tombstone/undelete by LWW', () => {
  const db = mockFixture.database;
  const original = { id: 'reading', weightValue: '176', weightUnit: 'lb', weightKg: 79.83225712,
    measuredAt: new Date(1000), createdAt: new Date(1000), updatedAt: new Date(1000), deletedAt: null,
    localDirty: true, localUpdatedAtMs: 100,
  };
  const wire = entityToWire(original, 'body_weight_measurements');
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

 it.each([100, 200])('hydrates previously unknown metadata without overwriting a local edit at clock %i', localMs => {
  const db = mockFixture.database;
  db.insert(exerciseDefinitions).values({ id: 'legacy', name: 'Local name',
    bodyweightCoefficient: 0, localBodyweightMetadataKnown: false, localDirty: true, localUpdatedAtMs: localMs,
  }).run();
  const before = db.select().from(exerciseDefinitions).get();
  if (!before) throw new Error('Missing legacy row');
  const pushed = entityToWire(before, 'exercise_definitions');
  expect(pushed.fields).not.toHaveProperty('bodyweight_coefficient');
  expect(pushed.fields).not.toHaveProperty('movement_standard');
  expect(pushed.fields).not.toHaveProperty('loading_method');
  const wire = { ...pushed, client_updated_at_ms: 100, fields: { ...pushed.fields,
    name: 'Server name', bodyweight_coefficient: 1, movement_standard: 'strict', loading_method: 'weighted',
  } };
  const apply = () => db.transaction(tx => applyPullPage(tx as Transaction, [wire], 'exercise_definitions'));
  expect(apply()).toBe(1);
  const hydrated = db.select().from(exerciseDefinitions).get();
  expect(hydrated).toMatchObject({ name: 'Local name', bodyweightCoefficient: 1,
    movementStandard: 'strict', loadingMethod: 'weighted', localBodyweightMetadataKnown: true,
    localDirty: true, localUpdatedAtMs: localMs,
  });
  expect(entityToWire(hydrated as Record<string, unknown>, 'exercise_definitions').fields.bodyweight_coefficient).toBe(1);
  wire.fields.bodyweight_coefficient = 0.7;
  expect(apply()).toBe(0);
  expect(db.select().from(exerciseDefinitions).get()?.bodyweightCoefficient).toBe(1);
});
