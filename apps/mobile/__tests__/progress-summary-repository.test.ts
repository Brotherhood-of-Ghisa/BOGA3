/**
 * Today's progress read over a real, fully migrated database. Sessions and
 * working sets come from the stats aggregation (proven equal to
 * `aggregateStats` over the same window), PRs from the exercise session facts
 * (one per record kind),
 * and every figure places a session by its `completed_at`. The suite runs in
 * Europe/London (jest.config.js).
 *
 * The PR rule's own edge cases live in `exercise-session-facts*.test.ts`; the
 * window arithmetic in `progress-summary-calculations.test.ts`.
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

import { __resetClockForTests } from '@/src/data/clock';
import { exerciseDefinitions, exerciseSets, gyms, sessionExercises, sessions } from '@/src/data/schema';
import { aggregateStats, createDrizzleStatsStore } from '@/src/data/stats';
import {
  createDrizzleProgressSummaryStore,
  createTodayProgressRepository,
  loadTodayProgress,
  type ProgressSummaryStore,
  type TodayProgress,
} from '@/src/progress-summary';
import { localWeekWindow } from '@/src/utils/local-calendar';

const BENCH = 'def-bench';
const SQUAT = 'def-squat';
const local = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);

type SetSpec = [weight: string, reps: string, setType?: string | null, status?: string | null];
type BlockSpec = { definitionId: string | null; name?: string; sets: SetSpec[]; deleted?: boolean };
type SessionSpec = {
  startedAt?: Date;
  completedAt: Date;
  status?: 'active' | 'completed';
  deletedAt?: Date;
  gymId?: string;
  durationSec?: number;
};

let fixture: InMemoryDatabaseFixture;
const db = () => fixture.database;

const insertSession = (id: string, spec: SessionSpec, blocks: BlockSpec[]) => {
  const status = spec.status ?? 'completed';
  db().insert(sessions).values({
    id,
    status,
    gymId: spec.gymId ?? null,
    startedAt: spec.startedAt ?? new Date(spec.completedAt.getTime() - 60 * 60 * 1000),
    completedAt: status === 'completed' ? spec.completedAt : null,
    durationSec: spec.durationSec ?? null,
    deletedAt: spec.deletedAt ?? null,
  }).run();
  blocks.forEach((block, blockIndex) => {
    const blockId = `${id}-b${blockIndex}`;
    db().insert(sessionExercises).values({
      id: blockId,
      sessionId: id,
      exerciseDefinitionId: block.definitionId,
      orderIndex: blockIndex,
      name: block.name ?? block.definitionId ?? 'Legacy lift',
      deletedAt: block.deleted ? spec.completedAt : null,
    }).run();
    block.sets.forEach(([weightValue, repsValue, setType = 'rir_2', performanceStatus = null], setIndex) => {
      db().insert(exerciseSets).values({
        id: `${blockId}-s${setIndex}`,
        sessionExerciseId: blockId,
        orderIndex: setIndex,
        weightValue,
        repsValue,
        setType,
        performanceStatus,
      }).run();
    });
  });
};

const bench = (weight: string, count = 1): BlockSpec =>
  ({ definitionId: BENCH, sets: Array.from({ length: count }, () => [weight, '5'] as SetSpec) });

const ready = (progress: TodayProgress) => {
  if (progress.status !== 'ready') throw new Error('expected a ready summary');
  return progress;
};

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase();
  mockActiveDatabase = fixture.database;
  db().insert(exerciseDefinitions).values([
    { id: BENCH, name: 'Bench Press' },
    { id: SQUAT, name: 'Squat' },
  ]).run();
});

afterEach(() => {
  fixture.close();
  mockActiveDatabase = null;
});

// Wednesday 14 Oct 2026: this week starts Monday 12 Oct, last week Monday 5 Oct.
const NOW = local(2026, 10, 14, 12);
const THIS_MONDAY = local(2026, 10, 12);

describe('loadTodayProgress', () => {
  it('returns the empty state when no completed, live session exists', async () => {
    insertSession('active', { completedAt: local(2026, 10, 14, 9), status: 'active' }, [bench('100')]);
    insertSession('deleted', { completedAt: local(2026, 10, 13), deletedAt: local(2026, 10, 13, 1) }, [bench('100')]);

    await expect(loadTodayProgress(NOW)).resolves.toEqual({ status: 'empty' });
  });

  it('counts sessions, working sets and PRs (one per record kind) per week and month', async () => {
    insertSession('sep-28', { completedAt: local(2026, 9, 28, 18) }, [bench('90', 2)]); // first bench: no PR
    insertSession('oct-6', { completedAt: local(2026, 10, 6, 18) }, [bench('95', 3)]); // 1RM, Weight and Volume: 3 PRs
    insertSession('oct-12', { completedAt: THIS_MONDAY }, [ // 1RM and Weight (Volume falls short): 2 PRs on the week boundary
      { definitionId: BENCH, sets: [['60', '5', 'warm_up'], ['100', '5'], ['100', '5', 'rir_1', 'planned'], ['100', '']] },
      { definitionId: SQUAT, sets: [['140', '5']] }, // first squat: no PR
      { definitionId: null, sets: [['20', '10', 'rir_1']] }, // unlinked: a working set, never a PR
    ]);
    insertSession('oct-13', { completedAt: local(2026, 10, 13, 18) }, [bench('80', 2)]); // no PR
    insertSession('oct-13-deleted', { completedAt: local(2026, 10, 13, 19), deletedAt: local(2026, 10, 13, 20) }, [bench('200', 5)]);
    insertSession('oct-14-active', { completedAt: local(2026, 10, 14, 9), status: 'active' }, [bench('200', 5)]);

    const { week, month } = ready(await loadTodayProgress(NOW));

    expect(week.current).toEqual({ sessions: 2, workingSets: 5, prs: 2 });
    expect(week.previous).toEqual({ sessions: 1, workingSets: 3, prs: 3 });
    expect(month.toDate).toEqual({ sessions: 3, workingSets: 8, prs: 5 });
    expect(month.cumulativeWorkingSets).toEqual([0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 6, 8, 8]);
    expect(month.previous.toSameDay).toEqual({ sessions: 0, workingSets: 0, prs: 0 });
    expect(month.previous.total).toEqual({ sessions: 1, workingSets: 2, prs: 0 });
  });

  it('matches aggregateStats over the same calendar week', async () => {
    insertSession('a', { completedAt: local(2026, 10, 12, 7) }, [bench('100', 3), { definitionId: SQUAT, sets: [['100', '5', 'warm_up'], ['120', '5']] }]);
    insertSession('b', { completedAt: local(2026, 10, 14, 7) }, [{ definitionId: null, sets: [['10', '12'], ['10', '', 'rir_0']] }]);

    const { week } = ready(await loadTodayProgress(NOW));
    const stats = aggregateStats(await createDrizzleStatsStore().loadAggregationInput(localWeekWindow(NOW)));

    expect(week.current.sessions).toBe(stats.sessionCount);
    expect(week.current.workingSets).toBe(stats.workingSetCount);
    expect(week.current.workingSets).toBe(5);
  });

  it('places a session that crosses midnight into the week it completed in, for sessions, sets and PRs', async () => {
    insertSession('earlier', { completedAt: local(2026, 10, 5, 18) }, [bench('90')]);
    insertSession('sunday-night', {
      startedAt: local(2026, 10, 11, 23, 30),
      completedAt: local(2026, 10, 12, 0, 40),
    }, [bench('100', 2)]);

    const { week } = ready(await loadTodayProgress(NOW));

    // 100 × 5 twice over 90 × 5 once: 1RM, Weight and Volume.
    expect(week.current).toEqual({ sessions: 1, workingSets: 2, prs: 3 });
    expect(week.previous).toEqual({ sessions: 1, workingSets: 1, prs: 0 });
  });

  it('summarises the latest completed session by completed_at', async () => {
    db().insert(gyms).values({ id: 'gym-1', name: 'Iron Works' }).run();
    insertSession('previous', { completedAt: local(2026, 10, 6, 18) }, [bench('90', 2), { definitionId: SQUAT, sets: [['100', '5']] }]);
    insertSession('latest', {
      startedAt: local(2026, 10, 13, 17),
      completedAt: local(2026, 10, 13, 18, 15),
      durationSec: 4500,
      gymId: 'gym-1',
    }, [
      { definitionId: SQUAT, name: 'Back Squat', sets: [['110', '5'], ['60', '5', 'warm_up']] }, // 1RM, Weight, Volume
      { definitionId: null, name: 'Removed lift', deleted: true, sets: [['50', '5']] },
      { definitionId: BENCH, name: 'Bench Press', sets: [['95', '5'], ['95', '5']] }, // 1RM, Weight, Volume
      { definitionId: null, name: 'Face Pull', sets: [['15', '15', 'rir_2', 'unperformed']] },
    ]);
    // Started later but completed earlier: not the latest.
    insertSession('started-later', { startedAt: local(2026, 10, 13, 17, 30), completedAt: local(2026, 10, 13, 18) }, [bench('50')]);

    const { latest } = ready(await loadTodayProgress(NOW));

    expect(latest).toEqual({
      id: 'latest',
      startedAt: local(2026, 10, 13, 17),
      completedAt: local(2026, 10, 13, 18, 15),
      durationSec: 4500,
      gymName: 'Iron Works',
      workingSets: 3,
      exerciseCount: 3,
      // One per record kind, in exercise then kind order, named by the definition.
      records: [
        { kind: 'oneRepMax', exerciseName: 'Bench Press', value: expect.closeTo(110.75, 2), reps: null },
        { kind: 'weight', exerciseName: 'Bench Press', value: 95, reps: 5 },
        { kind: 'volume', exerciseName: 'Bench Press', value: 950, reps: null },
        { kind: 'oneRepMax', exerciseName: 'Squat', value: expect.closeTo(128.24, 2), reps: null },
        { kind: 'weight', exerciseName: 'Squat', value: 110, reps: 5 },
        { kind: 'volume', exerciseName: 'Squat', value: 550, reps: null },
      ],
    });
  });

  it('summarises a latest session older than both months, with zero figures for the windows', async () => {
    insertSession('may-1', { completedAt: local(2026, 5, 1, 18) }, [bench('90')]);
    insertSession('may-8', { completedAt: local(2026, 5, 8, 18) }, [bench('100', 4)]);

    const progress = ready(await loadTodayProgress(NOW));

    expect(progress.latest).toMatchObject({ id: 'may-8', workingSets: 4, exerciseCount: 1, gymName: null, durationSec: null });
    expect(progress.latest.records.map((record) => record.kind)).toEqual(['oneRepMax', 'weight', 'volume']);
    expect(progress.week.current).toEqual({ sessions: 0, workingSets: 0, prs: 0 });
    expect(progress.month.previous.total).toEqual({ sessions: 0, workingSets: 0, prs: 0 });
  });

  it('reads the latest session alone only when it is older than the loaded range', async () => {
    const store = createDrizzleProgressSummaryStore();
    const counted: ProgressSummaryStore = {
      ...store,
      loadAggregationInput: jest.fn(store.loadAggregationInput),
      loadRecordFacts: jest.fn(store.loadRecordFacts),
    };
    const { loadTodayProgress: load } = createTodayProgressRepository(counted);

    insertSession('may-8', { completedAt: local(2026, 5, 8, 18) }, [bench('100')]);
    await load(NOW);
    expect(counted.loadAggregationInput).toHaveBeenCalledTimes(2);
    expect(counted.loadRecordFacts).toHaveBeenCalledTimes(2);

    jest.mocked(counted.loadAggregationInput).mockClear();
    jest.mocked(counted.loadRecordFacts).mockClear();
    insertSession('oct-13', { completedAt: local(2026, 10, 13, 18) }, [bench('110', 2)]);
    const latest = ready(await load(NOW)).latest;
    expect(latest).toMatchObject({ id: 'oct-13', workingSets: 2 });
    // 110 × 5 twice over one 100 × 5: 1RM, Weight and Volume.
    expect(latest.records.map((record) => record.kind)).toEqual(['oneRepMax', 'weight', 'volume']);
    expect(counted.loadAggregationInput).toHaveBeenCalledTimes(1);
    expect(counted.loadRecordFacts).toHaveBeenCalledTimes(1);
  });
});
