/**
 * The workout in progress as personal Progress reads it
 * (`training-metrics-contract.md` §2): which active session it is, where it is
 * dated, and that the catalogue's shared history carries it without counting
 * it. Each Progress screen's own use is proved over real data in
 * `stats-screen-local-data`, `progress-history-local-data` and
 * `progress-summary-repository`.
 */
/* eslint-disable import/first */

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

let mockActiveDatabase: InMemoryTestDatabase | null = null;

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockActiveDatabase) throw new Error('test database not initialised');
    return mockActiveDatabase;
  }),
}));

import {
  aggregateExerciseCatalogStats,
  loadExerciseCatalogStatsRawHistory,
  withInProgressSession,
} from '@/src/data/exercise-catalog-stats';
import {
  inProgressSessionDate,
  selectDatedInProgressSession,
  selectInProgressSessionRow,
} from '@/src/data/in-progress-session';
import { exerciseDefinitions, exerciseSets, sessionExercises, sessions } from '@/src/data/schema';
import { findActiveSessionId } from '@/src/data/session-list';

const BENCH = 'def-bench';
const NOW = new Date(2026, 9, 14, 12);
const HOUR_MS = 60 * 60 * 1000;

let fixture: InMemoryDatabaseFixture;
const db = () => fixture.database;

const insertSession = (
  id: string,
  { status = 'active', updatedAt = NOW, deletedAt = null }: {
    status?: 'active' | 'completed'; updatedAt?: Date; deletedAt?: Date | null;
  } = {}
) => {
  const startedAt = new Date(updatedAt.getTime() - HOUR_MS);
  db().insert(sessions).values({
    id,
    status,
    startedAt,
    completedAt: status === 'completed' ? updatedAt : null,
    deletedAt,
    createdAt: startedAt,
    updatedAt,
  }).run();
  db().insert(sessionExercises).values({
    id: `${id}-b0`, sessionId: id, exerciseDefinitionId: BENCH, orderIndex: 0, name: 'Bench Press',
  }).run();
  db().insert(exerciseSets).values([
    { id: `${id}-s0`, sessionExerciseId: `${id}-b0`, orderIndex: 0, weightValue: '100', repsValue: '5', setType: 'rir_2' },
    {
      id: `${id}-s1`, sessionExerciseId: `${id}-b0`, orderIndex: 1, weightValue: '100', repsValue: '5', setType: 'rir_2',
      performanceStatus: 'planned',
    },
  ]).run();
};

beforeEach(() => {
  fixture = createInMemoryDatabase();
  mockActiveDatabase = fixture.database;
  db().insert(exerciseDefinitions).values({ id: BENCH, name: 'Bench Press' }).run();
});

afterEach(() => {
  fixture.close();
  mockActiveDatabase = null;
});

describe('the workout in progress', () => {
  it('is the most recently updated live active session, the one the recorder opens', async () => {
    expect(selectInProgressSessionRow(db())).toBeNull();
    insertSession('completed', { status: 'completed', updatedAt: new Date(NOW.getTime() + HOUR_MS) });
    insertSession('deleted', { updatedAt: new Date(NOW.getTime() + HOUR_MS), deletedAt: NOW });
    insertSession('older', { updatedAt: new Date(NOW.getTime() - HOUR_MS) });
    insertSession('newer');

    expect(selectInProgressSessionRow(db())?.id).toBe('newer');
    await expect(findActiveSessionId()).resolves.toBe('newer');
  });

  it('is dated the instant before the read, inside a window ending now and outside one starting now', () => {
    insertSession('active');
    const date = inProgressSessionDate(NOW);
    expect(date.getTime()).toBe(NOW.getTime() - 1);

    const earlier = new Date(NOW.getTime() - 24 * HOUR_MS);
    expect(selectDatedInProgressSession(db(), { start: earlier, end: NOW, now: NOW }))
      .toEqual({ id: 'active', startedAt: new Date(NOW.getTime() - HOUR_MS), completedAt: date, gymId: null, gymName: null });
    expect(selectDatedInProgressSession(db(), { start: NOW, end: new Date(NOW.getTime() + HOUR_MS), now: NOW })).toBeNull();
    expect(selectDatedInProgressSession(db(), { start: earlier, end: date, now: NOW })).toBeNull();
  });

  it('rides in the catalogue history undated, counted only once Progress dates it', async () => {
    insertSession('completed', { status: 'completed', updatedAt: new Date(NOW.getTime() - 48 * HOUR_MS) });
    insertSession('active');
    const raw = await loadExerciseCatalogStatsRawHistory();

    expect(raw.sessions.map(session => session.id)).toEqual(['completed']);
    expect(raw.inProgressSession?.id).toBe('active');
    // The catalogue and pickers: completed history only.
    const catalogue = aggregateExerciseCatalogStats(raw, 'all', NOW);
    expect(catalogue.aggregatesById.get(BENCH)?.workingSetCount).toBe(1);
    expect(catalogue.lastCompletedAtById.get(BENCH)).toEqual(new Date(NOW.getTime() - 48 * HOUR_MS));
    // Progress: its confirmed set counts, in a window ending now.
    const progress = aggregateExerciseCatalogStats(
      withInProgressSession(raw, NOW), { start: new Date(NOW.getTime() - 24 * HOUR_MS), end: NOW }, NOW
    );
    expect(progress.aggregatesById.get(BENCH)).toMatchObject({ sessionCount: 1, workingSetCount: 1 });
    expect(withInProgressSession({ ...raw, inProgressSession: null }, NOW)).toEqual({ ...raw, inProgressSession: null });
  });
});
