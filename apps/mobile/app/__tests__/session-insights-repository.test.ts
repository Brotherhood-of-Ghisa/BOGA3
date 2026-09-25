import { exerciseDefinitions, exerciseSets, sessionExercises, sessions } from '@/src/data/schema';
import { createDrizzleSessionInsightsStore, createCompletedSessionInsightsRepository } from '@/src/session-insights';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

let mockActiveDatabase: InMemoryTestDatabase | null = null;

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockActiveDatabase) {
      throw new Error('test database not initialised');
    }
    return mockActiveDatabase;
  }),
}));

describe('Drizzle session insights store', () => {
  let fixture: InMemoryDatabaseFixture;

  beforeEach(() => {
    fixture = createInMemoryDatabase({ foreignKeys: true });
    mockActiveDatabase = fixture.database;
    fixture.database
      .insert(exerciseDefinitions)
      .values({ id: 'bench', name: 'Current Bench Press' })
      .run();
    fixture.database
      .insert(sessions)
      .values({
        id: 'target',
        gymId: null,
        status: 'completed',
        startedAt: new Date('2026-09-12T09:00:00.000Z'),
        completedAt: new Date('2026-09-12T10:00:00.000Z'),
      })
      .run();
  });

  afterEach(() => {
    fixture.close();
    mockActiveDatabase = null;
  });

  it('resolves linked exercise names from current catalog metadata', async () => {
    fixture.database
      .insert(sessionExercises)
      .values({
        id: 'target-bench',
        sessionId: 'target',
        exerciseDefinitionId: 'bench',
        orderIndex: 0,
        name: 'Captured Bench Press',
      })
      .run();

    const rows = await createDrizzleSessionInsightsStore().loadSessionExercises(['target']);

    expect(rows).toEqual([
      expect.objectContaining({
        exerciseDefinitionId: 'bench',
        exerciseName: 'Current Bench Press',
      }),
    ]);
  });

  it('loads comparison graphs before the supplied boundary and excludes the target, later, active and deleted sessions', async () => {
    const database = fixture.database;
    const before = new Date('2026-09-11T12:00:00Z');
    const boundary = new Date('2026-09-12T10:00:00Z');
    for (const row of [
      { id: 'prior', status: 'completed', completedAt: before },
      { id: 'later', status: 'completed', completedAt: new Date('2026-09-13T12:00:00Z') },
      { id: 'active', status: 'active', completedAt: null },
      { id: 'deleted', status: 'completed', completedAt: before, deletedAt: before },
    ] as const) {
      database.insert(sessions).values({ ...row, gymId: null, startedAt: before }).run();
      database.insert(sessionExercises).values({ id: row.id + '-bench', sessionId: row.id, exerciseDefinitionId: 'bench', orderIndex: 0, name: 'Bench' }).run();
      database.insert(exerciseSets).values({ id: row.id + '-set', sessionExerciseId: row.id + '-bench', orderIndex: 0, weightValue: '0', repsValue: '10', setType: 'rir_2' }).run();
    }
    const history = await createCompletedSessionInsightsRepository().loadHistory({ targetSessionId: 'target', completedAt: boundary });
    expect(history).toEqual([expect.objectContaining({
      sessionId: 'prior', exercises: [expect.objectContaining({
        id: 'prior-bench', sets: [expect.objectContaining({ id: 'prior-set', weightValue: '0', repsValue: '10' })],
      })],
    })]);
  });

  it('keeps the captured name for an unlinked legacy exercise', async () => {
    fixture.database
      .insert(sessionExercises)
      .values({
        id: 'target-unlinked',
        sessionId: 'target',
        exerciseDefinitionId: null,
        orderIndex: 0,
        name: 'Legacy Movement',
      })
      .run();

    const rows = await createDrizzleSessionInsightsStore().loadSessionExercises(['target']);

    expect(rows).toEqual([
      expect.objectContaining({
        exerciseDefinitionId: null,
        exerciseName: 'Legacy Movement',
      }),
    ]);
  });
});
