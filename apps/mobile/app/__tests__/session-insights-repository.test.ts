import { exerciseDefinitions, sessionExercises, sessions } from '@/src/data/schema';
import { createDrizzleSessionInsightsStore } from '@/src/session-insights';

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
