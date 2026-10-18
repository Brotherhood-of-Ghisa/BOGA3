/**
 * The views of a gym picker over a real, migrated database ([[gym.split]]):
 * every view reads the whole exercise until a gym is chosen, then only that
 * gym's sessions. On an exercise split per gym, a chosen gym's PR marks are its
 * own book's ([[gym.split-progress-prs]]), and Repeat last prefers the newest
 * session in the book the block is planned for, falling back to the whole
 * exercise's newest. Nothing writes `split_by_gym` yet, so the fixture sets it.
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

import { eq } from 'drizzle-orm';

import { __resetClockForTests } from '@/src/data/clock';
import { computeSelectedExerciseHistoryEffort } from '@/src/data/exercise-analytics';
import { loadSuggestedExercisePlan } from '@/src/data/exercise-block-history';
import {
  aggregateExerciseCatalogStats,
  exerciseCatalogStatsGymOptions,
  loadExerciseCatalogStatsRawHistory,
  withInProgressSession,
} from '@/src/data/exercise-catalog-stats';
import { loadExercisePerformanceHistory } from '@/src/data/exercise-history';
import { loadGymBookSessionIds } from '@/src/data/exercise-session-facts';
import { exerciseDefinitions, exerciseSets, gyms, sessionExercises, sessions } from '@/src/data/schema';

const BENCH = 'def-bench';
const SQUAT = 'def-squat';
const day = (n: number, hour = 18) => new Date(Date.UTC(2026, 0, n, hour));

let fixture: InMemoryDatabaseFixture;
const db = () => fixture.database;

const insertSession = (
  id: string,
  dayNumber: number,
  definitionId: string,
  sets: [weight: string, reps: string][],
  gymId: string | null = null,
  status: 'completed' | 'active' = 'completed',
) => {
  db().insert(sessions).values({
    id,
    status,
    startedAt: day(dayNumber, 17),
    completedAt: status === 'completed' ? day(dayNumber) : null,
    gymId,
  }).run();
  db().insert(sessionExercises).values({
    id: `${id}-b0`, sessionId: id, exerciseDefinitionId: definitionId, orderIndex: 0, name: definitionId,
  }).run();
  sets.forEach(([weightValue, repsValue], setIndex) => {
    db().insert(exerciseSets).values({
      id: `${id}-b0-s${setIndex}`, sessionExerciseId: `${id}-b0`, orderIndex: setIndex,
      weightValue, repsValue, setType: 'rir_2',
    }).run();
  });
};

const split = () => db().update(exerciseDefinitions)
  .set({ splitByGym: true }).where(eq(exerciseDefinitions.id, BENCH)).run();

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase();
  mockActiveDatabase = fixture.database;
  db().insert(exerciseDefinitions).values([{ id: BENCH, name: 'Bench Press' }, { id: SQUAT, name: 'Squat' }]).run();
  db().insert(gyms).values([{ id: 'home', name: 'Home' }, { id: 'club', name: 'Club' }, { id: 'annex', name: 'Annex' }]).run();
  // Home holds the whole exercise's records; Club's own book rises below them.
  insertSession('home-1', 1, BENCH, [['100', '5']], 'home');
  insertSession('club-1', 2, BENCH, [['60', '5']], 'club');
  insertSession('club-2', 3, BENCH, [['70', '5']], 'club');
  insertSession('none-1', 4, BENCH, [['110', '5']]);
  insertSession('home-2', 5, BENCH, [['50', '5']], 'home');
  insertSession('squat-annex', 6, SQUAT, [['80', '5']], 'annex');
});

afterEach(() => {
  fixture.close();
  mockActiveDatabase = null;
});

describe('the record book a block is planned for', () => {
  it('is a split exercise\'s gym, or every session (null) for no gym or an unsplit exercise', async () => {
    expect(await loadGymBookSessionIds(BENCH, { gymId: 'club' })).toBeNull();
    split();
    expect(await loadGymBookSessionIds(BENCH, { gymId: 'club' })).toEqual(new Set(['club-1', 'club-2']));
    expect(await loadGymBookSessionIds(BENCH, { gymId: null })).toBeNull();
    expect(await loadGymBookSessionIds(BENCH, { inSessionId: 'home-2' })).toEqual(new Set(['home-1', 'home-2']));
    expect(await loadGymBookSessionIds(BENCH, { inSessionId: 'none-1' })).toBeNull();
    // A gym the exercise was never trained at has an empty book.
    expect(await loadGymBookSessionIds(BENCH, { gymId: 'annex' })).toEqual(new Set());
  });
});

describe('Repeat last and plan prefill', () => {
  const repeated = async (options: Parameters<typeof loadSuggestedExercisePlan>[0]) =>
    (await loadSuggestedExercisePlan(options))?.sessionId ?? null;

  it('repeats the newest session for an unsplit exercise, wherever it is planned', async () => {
    expect(await repeated({ exerciseDefinitionId: BENCH, gymId: 'club' })).toBe('home-2');
    expect(await repeated({ exerciseDefinitionId: BENCH })).toBe('home-2');
  });

  it('on a split exercise repeats the newest session at the same gym', async () => {
    split();
    expect(await repeated({ exerciseDefinitionId: BENCH, gymId: 'club' })).toBe('club-2');
    insertSession('active-club', 7, SQUAT, [['1', '1']], 'club', 'active');
    expect(await repeated({ exerciseDefinitionId: BENCH, inSessionId: 'active-club' })).toBe('club-2');
  });

  it('with no gym, or a first visit to a gym, takes the whole exercise\'s newest', async () => {
    split();
    expect(await repeated({ exerciseDefinitionId: BENCH, gymId: null })).toBe('home-2');
    insertSession('active-none', 7, SQUAT, [['1', '1']], null, 'active');
    expect(await repeated({ exerciseDefinitionId: BENCH, inSessionId: 'active-none' })).toBe('home-2');
    expect(await repeated({ exerciseDefinitionId: BENCH, gymId: 'annex' })).toBe('home-2');
  });
});

describe('the exercise heatmap', () => {
  const window = { start: day(1, 0), end: day(10, 0), timeZone: 'UTC', exerciseDefinitionId: BENCH };
  const prDays = (daily: { dateKey: string; personalRecordCounts: { highestWeight: number } }[]) =>
    daily.filter((entry) => entry.personalRecordCounts.highestWeight > 0).map((entry) => entry.dateKey);

  it('marks whole-exercise PRs for every gym, and a chosen gym\'s own book when one is chosen', async () => {
    split();
    const all = await computeSelectedExerciseHistoryEffort(window);
    expect(all.daily.flatMap((entry) => entry.sessionIds ?? [])).toHaveLength(5);
    // home-1 is the first value, so a baseline; none-1 beats it.
    expect(prDays(all.daily)).toEqual(['2026-01-04']);

    const club = await computeSelectedExerciseHistoryEffort({ ...window, gymId: 'club' });
    expect(club.daily.flatMap((entry) => entry.sessionIds ?? [])).toEqual(['club-1', 'club-2']);
    // Club's own book: club-2 beats club-1, though never the whole exercise.
    expect(prDays(club.daily)).toEqual(['2026-01-03']);

    const none = await computeSelectedExerciseHistoryEffort({ ...window, gymId: null });
    expect(none.daily.flatMap((entry) => entry.sessionIds ?? [])).toEqual(['none-1']);
    expect(prDays(none.daily)).toEqual(['2026-01-04']);
  });

  it('marks the same PRs for a chosen gym of an unsplit exercise as the whole exercise does', async () => {
    const club = await computeSelectedExerciseHistoryEffort({ ...window, gymId: 'club' });
    expect(prDays(club.daily)).toEqual([]);
  });

  it('offers the window\'s gyms, most recently trained first, with their sessions, whatever is chosen', async () => {
    const expected = [
      { gymId: 'home', name: 'Home', sessionCount: 2 },
      { gymId: null, name: null, sessionCount: 1 },
      { gymId: 'club', name: 'Club', sessionCount: 2 },
    ];
    expect((await computeSelectedExerciseHistoryEffort(window)).gyms).toEqual(expected);
    expect((await computeSelectedExerciseHistoryEffort({ ...window, gymId: 'club' })).gyms).toEqual(expected);
  });
});

describe('catalog stats and Progress rows', () => {
  it('count only the chosen gym\'s sessions, every figure included', async () => {
    const raw = await loadExerciseCatalogStatsRawHistory();
    const now = day(10);
    const all = aggregateExerciseCatalogStats(raw, 'all', now);
    expect(all.aggregatesById.get(BENCH)?.sessionCount).toBe(5);
    expect(all.lastCompletedAtById.get(BENCH)).toEqual(day(5));

    const club = aggregateExerciseCatalogStats(raw, 'all', now, { gymId: 'club' });
    expect(club.aggregatesById.get(BENCH)?.sessionCount).toBe(2);
    expect(club.lastCompletedAtById.get(BENCH)).toEqual(day(3));
    expect(club.everDoneIds.has(SQUAT)).toBe(false);
    expect(club.recencyScoresById.get(BENCH)?.completedSetCount).toBe(2);

    const none = aggregateExerciseCatalogStats(raw, 'all', now, { gymId: null });
    expect(none.aggregatesById.get(BENCH)?.sessionCount).toBe(1);
    expect(none.aggregatesById.get(BENCH)?.estimatedOneRepMax).toBe(all.aggregatesById.get(BENCH)?.estimatedOneRepMax);
  });

  it('offer every gym trained at, most recently first', async () => {
    expect(exerciseCatalogStatsGymOptions(await loadExerciseCatalogStatsRawHistory())).toEqual([
      { gymId: 'annex', name: 'Annex' },
      { gymId: 'home', name: 'Home' },
      { gymId: null, name: null },
      { gymId: 'club', name: 'Club' },
    ]);
  });
});

describe('the workout in progress', () => {
  it('counts at its own gym, in the heatmap and in Progress rows, and offers that gym', async () => {
    insertSession('active-annex', 9, BENCH, [['90', '5']], 'annex', 'active');
    db().update(exerciseSets).set({ performanceStatus: 'performed' }).where(eq(exerciseSets.id, 'active-annex-b0-s0')).run();
    const now = day(9, 19);
    const window = { start: day(1, 0), end: day(10, 0), timeZone: 'UTC', exerciseDefinitionId: BENCH, now };
    const sessionsAt = async (gymId?: string | null) =>
      (await computeSelectedExerciseHistoryEffort({ ...window, ...(gymId === undefined ? {} : { gymId }) }))
        .daily.flatMap((entry) => entry.sessionIds ?? []);
    expect(await sessionsAt('annex')).toEqual(['active-annex']);
    expect(await sessionsAt(null)).toEqual(['none-1']);
    expect(await sessionsAt()).toContain('active-annex');

    const raw = withInProgressSession(await loadExerciseCatalogStatsRawHistory(), now);
    expect(aggregateExerciseCatalogStats(raw, 'all', now, { gymId: 'annex' }).aggregatesById.get(BENCH)?.sessionCount).toBe(1);
    expect(exerciseCatalogStatsGymOptions(raw)[0]).toEqual({ gymId: 'annex', name: 'Annex' });
  });
});

describe('exercise history\'s gym options', () => {
  it('keep the chosen gym, by name, when the period holds none of its sessions', async () => {
    const summary = (await loadExercisePerformanceHistory({
      exerciseDefinitionId: BENCH, period: 'all', gymId: 'annex', now: day(10),
    }))!;
    expect(summary.sessions).toEqual([]);
    expect(summary.gymOptions).toContainEqual({ gymId: 'annex', name: 'Annex', occurrenceCount: 0 });
  });
});
