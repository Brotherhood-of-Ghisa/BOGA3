import { eq } from 'drizzle-orm';
import { exerciseDefinitions, exerciseMuscleMappings, exerciseSets, muscleGroups, sessionExercises, sessions } from '@/src/data/schema';
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

  const addBench = (id: string, completedAt: Date, weight: number) => {
    if (id !== 'target') fixture.database.insert(sessions).values({ id, status: 'completed', startedAt: completedAt, completedAt }).run();
    fixture.database.insert(sessionExercises).values({ id: `${id}-bench`, sessionId: id, exerciseDefinitionId: 'bench', name: 'Bench', orderIndex: 0 }).run();
    fixture.database.insert(exerciseSets).values({ id: `${id}-set`, sessionExerciseId: `${id}-bench`, weightValue: String(weight), repsValue: '10', setType: 'rir_2', orderIndex: 0 }).run();
  };

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
      { id: 'at-start', status: 'completed', completedAt: new Date(2026, 7, 31) },
      { id: 'too-old', status: 'completed', completedAt: new Date(new Date(2026, 7, 31).getTime() - 1) },
      { id: 'same-time-before', status: 'completed', completedAt: boundary },
      { id: 'z-same-time-after', status: 'completed', completedAt: boundary },
      { id: 'later', status: 'completed', completedAt: new Date('2026-09-13T12:00:00Z') },
      { id: 'active', status: 'active', completedAt: null },
      { id: 'deleted', status: 'completed', completedAt: before, deletedAt: before },
    ] as const) {
      database.insert(sessions).values({ ...row, gymId: null, startedAt: before }).run();
      database.insert(sessionExercises).values({ id: row.id + '-bench', sessionId: row.id, exerciseDefinitionId: 'bench', orderIndex: 0, name: 'Bench' }).run();
      database.insert(exerciseSets).values({ id: row.id + '-set', sessionExerciseId: row.id + '-bench', orderIndex: 0, weightValue: '0', repsValue: '10', setType: 'rir_2' }).run();
    }
    const history = await createCompletedSessionInsightsRepository().loadHistory({ targetSessionId: 'target', completedAt: boundary, historyLookbackWeeks: 1 });
    expect(history.map(row => row.sessionId)).toEqual(['at-start', 'prior', 'same-time-before']);
    expect(history[1]).toEqual(expect.objectContaining({
      sessionId: 'prior', exercises: [expect.objectContaining({
        id: 'prior-bench', sets: [expect.objectContaining({ id: 'prior-set', weightValue: '0', repsValue: '10' })],
      })],
    }));
  });

  it('anchors exercise and muscle quartiles to the completed session window while keeping records all-time', async () => {
    const completedAt = new Date(2026, 9, 9, 12);
    fixture.database.update(sessions).set({ completedAt }).where(eq(sessions.id, 'target')).run();
    fixture.database.insert(muscleGroups).values({ id: 'chest', displayName: 'Chest', familyName: 'Chest' }).run();
    fixture.database.insert(exerciseMuscleMappings).values({ exerciseDefinitionId: 'bench', muscleGroupId: 'chest', role: 'primary', weight: 1 }).run();
    addBench('old-record', new Date(2026, 8, 27, 23, 59), 1000);
    for (let index = 0; index < 6; index++) addBench(`prior-${index}`, new Date(2026, 8, 28 + index), index * 100);
    addBench('target', completedAt, 700);

    const repository = createCompletedSessionInsightsRepository();
    const narrow = await repository.loadInsights('target', 1);
    const expected = { medianVolume: 2500, percentile25Volume: 1250, percentile75Volume: 3750, historicalSessionCount: 6 };
    expect(narrow?.exerciseVolumeComparisons[0]).toMatchObject(expected);
    expect(narrow?.muscleVolumeComparisons[0]).toMatchObject({ historicalSessionCount: 6, medianVolume: 1250, percentile25Volume: 625, percentile75Volume: 1875 });
    expect(narrow?.personalRecords).toEqual([]);
    const wider = await repository.loadInsights('target', 2);
    expect(wider?.exerciseVolumeComparisons[0]).toMatchObject({ medianVolume: 3000, historicalSessionCount: 7 });
    expect(wider?.muscleVolumeComparisons[0]).toMatchObject({ medianVolume: 1500, historicalSessionCount: 7 });
  });

  it('counts Sunday as complete and keeps only earlier sessions from that week for a one-week comparison', async () => {
    addBench('previous-week', new Date(2026, 9, 4, 23, 59), 100);
    addBench('current-week', new Date(2026, 9, 5), 200);
    const history = await createCompletedSessionInsightsRepository().loadHistory({
      targetSessionId: 'future-target', completedAt: new Date(2026, 9, 11, 10), historyLookbackWeeks: 1,
    });
    expect(history.map(row => row.sessionId)).toEqual(['current-week']);
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
