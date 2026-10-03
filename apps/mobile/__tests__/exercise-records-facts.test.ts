/**
 * The exercise page's records panel and exercise history's `All-time bests`
 * read the exercise session facts (spec 05, "Exercise session facts";
 * `ux-rules` §14a.4, §13.15) over a real, fully migrated database. A tie
 * across sessions goes to the earliest session. On a generated history the
 * facts-backed records equal the replay of every completed set (the
 * derivation the panel used before the facts), for every gym scope and
 * every completed session being edited.
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

import type { LocalDatabase } from '@/src/data/bootstrap';
import { __resetClockForTests } from '@/src/data/clock';
import { loadExercisePerformanceHistory, type ExerciseHistorySessionEntry } from '@/src/data/exercise-history';
import { drainExerciseSessionFacts, loadExerciseBests } from '@/src/data/exercise-session-facts';
import { compareFactSessionOrder } from '@/src/data/exercise-session-facts-derive';
import { exerciseDefinitions, exerciseSessionFacts, exerciseSets, gyms, sessionExercises, sessions } from '@/src/data/schema';
import { estimateOneRepMax, parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { calculateAnalyticsSetMetrics, ordinaryLoadContext } from '@/src/exercise-calculations/analytics';
import { canonicalizeWeightForReps, isWorkingSet } from '@/src/exercise-calculations/set-semantics';
import {
  deriveLastSession,
  recordBaselineOf,
  type ExerciseRecords,
} from '@/src/session-recorder/exercise-records';
import { loadExerciseRecords } from '@/src/session-recorder/use-exercise-records';

const BENCH = 'def-bench';
const SQUAT = 'def-squat';
const day = (n: number, hour = 18) => new Date(Date.UTC(2026, 0, n, hour));

type SetSpec = [weight: string, reps: string, setType?: string | null, status?: string | null];
type BlockSpec = { definitionId: string | null; sets: SetSpec[] };

let fixture: InMemoryDatabaseFixture;
const db = () => fixture.database;

const insertSession = (
  id: string,
  dayNumber: number,
  blocks: BlockSpec[],
  gymId: string | null = null,
) => {
  db().insert(sessions).values({
    id,
    status: 'completed',
    startedAt: day(dayNumber, 17),
    completedAt: day(dayNumber),
    gymId,
  }).run();
  blocks.forEach((block, blockIndex) => {
    const blockId = `${id}-b${blockIndex}`;
    db().insert(sessionExercises).values({
      id: blockId,
      sessionId: id,
      exerciseDefinitionId: block.definitionId,
      orderIndex: blockIndex,
      name: block.definitionId ?? 'Legacy lift',
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

const bench = (...sets: SetSpec[]): BlockSpec[] => [{ definitionId: BENCH, sets }];

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase();
  mockActiveDatabase = fixture.database;
  db().insert(exerciseDefinitions).values([
    { id: BENCH, name: 'Bench Press' },
    { id: SQUAT, name: 'Squat' },
  ]).run();
  db().insert(gyms).values([{ id: 'home', name: 'Home' }, { id: 'club', name: 'Club' }]).run();
});

afterEach(() => {
  fixture.close();
  mockActiveDatabase = null;
});

describe('exercise records from the facts', () => {
  it('never takes a warm-up as a record; Vol counts the working sets', async () => {
    insertSession('s1', 1, bench(['200', '5', 'warm_up'], ['100', '5'], ['90', '8']), 'home');

    const { records } = await loadExerciseRecords({ exerciseDefinitionId: BENCH });

    expect(records.oneRepMax).toMatchObject({ weight: 100, reps: 5, completedAt: day(1), gymId: 'home', gymName: 'Home' });
    expect(records.oneRepMax?.value).toBeCloseTo(estimateOneRepMax(100, 5) as number, 8);
    expect(records.maxWeight).toMatchObject({ weight: 100, reps: 5, completedAt: day(1) });
    expect(records.volume).toMatchObject({ value: 100 * 5 + 90 * 8, setCount: 2, completedAt: day(1) });
    expect(recordBaselineOf(records)).toEqual({ oneRepMax: records.oneRepMax!.value, weight: { weight: 100, reps: 5 } });
  });

  it('gives a tie across sessions to the earliest session; an equal top weight goes to more reps', async () => {
    insertSession('s1', 1, bench(['100', '5']));
    insertSession('s2', 2, bench(['100', '5']));
    insertSession('s3', 3, bench(['80', '3']));

    const tied = await loadExerciseBests({ exerciseDefinitionId: BENCH });
    expect([tied.oneRepMax?.sessionId, tied.topWeight?.sessionId, tied.volume?.sessionId]).toEqual(['s1', 's1', 's1']);
    expect(tied.latest?.sessionId).toBe('s3');

    insertSession('s4', 4, bench(['100', '6']));
    expect((await loadExerciseBests({ exerciseDefinitionId: BENCH })).topWeight).toMatchObject({ sessionId: 's4', weight: 100, reps: 6 });
  });

  it('takes the best volume from complete sessions only', async () => {
    insertSession('s1', 1, bench(['100', '5']));
    insertSession('s2', 2, [{ definitionId: SQUAT, sets: [['100', '5']] }]);
    drainExerciseSessionFacts(db() as unknown as LocalDatabase);
    // A larger known subtotal whose total is unknown never holds the record.
    db().insert(exerciseSessionFacts).values({
      sessionId: 's2', exerciseDefinitionId: BENCH, achievedAt: day(2), volumeKg: 9000,
      volumeComplete: false, workingSets: 3, prE1rm: false, prWeight: false, prVolume: false,
    }).run();

    const bests = await loadExerciseBests({ exerciseDefinitionId: BENCH });

    expect(bests.volume).toMatchObject({ sessionId: 's1', value: 500, workingSets: 1 });
    expect(bests.latest?.sessionId).toBe('s2');
  });

  it('scopes to one gym, or to sessions with no gym', async () => {
    insertSession('home-1', 1, bench(['100', '5']), 'home');
    insertSession('club-1', 2, bench(['150', '5']), 'club');
    insertSession('none-1', 3, bench(['120', '5']));

    const best = async (gymId?: string | null) =>
      (await loadExerciseBests({ exerciseDefinitionId: BENCH, ...(gymId === undefined ? {} : { gymId }) })).topWeight;

    expect(await best()).toMatchObject({ sessionId: 'club-1', gymName: 'Club' });
    expect(await best('home')).toMatchObject({ sessionId: 'home-1', gymId: 'home', gymName: 'Home' });
    expect(await best(null)).toMatchObject({ sessionId: 'none-1', gymId: null, gymName: null });
    expect(await best('nowhere')).toBeNull();
  });

  it('counts only the sessions before a completed session being edited, same-instant ties by session id', async () => {
    // localeCompare: 'a-same' < 'B-edited' < 'c-same'.
    insertSession('early', 1, bench(['100', '5']));
    insertSession('a-same', 2, bench(['110', '5']));
    insertSession('B-edited', 2, bench(['200', '5']));
    insertSession('c-same', 2, bench(['120', '5']));
    insertSession('later', 3, bench(['300', '5']));

    const { records, last } = await loadExerciseRecords({ exerciseDefinitionId: BENCH, beforeSessionId: 'B-edited' });

    expect(records.maxWeight).toMatchObject({ weight: 110, completedAt: day(2) });
    expect(last?.sets.map((set) => set.weight)).toEqual([110]);
    expect((await loadExerciseBests({ exerciseDefinitionId: BENCH, beforeSessionId: 'early' })))
      .toEqual({ oneRepMax: null, topWeight: null, volume: null, latest: null });
  });

  it('fails loudly when the session being edited is not a completed session', async () => {
    insertSession('s1', 1, bench(['100', '5']));
    db().insert(sessions).values({ id: 'active', status: 'active', startedAt: day(2) }).run();

    await expect(loadExerciseBests({ exerciseDefinitionId: BENCH, beforeSessionId: 'active' })).rejects.toThrow('not completed');
    await expect(loadExerciseBests({ exerciseDefinitionId: BENCH, beforeSessionId: 'missing' })).rejects.toThrow('not completed');
  });

  it('loads Last from the newest session with a working set, keeping its warm-up lines', async () => {
    insertSession('s1', 1, bench(['80', '5', 'rir_1']));
    insertSession('s2', 2, [
      { definitionId: BENCH, sets: [['140', '3', 'warm_up'], ['100', '5', 'rir_1']] },
      { definitionId: SQUAT, sets: [['180', '5']] },
      { definitionId: BENCH, sets: [['90', '8', 'rir_0']] },
    ]);
    insertSession('s3', 3, bench(['300', '5', 'warm_up']));

    const { records, last } = await loadExerciseRecords({ exerciseDefinitionId: BENCH });

    expect(last?.completedAt).toEqual(day(2));
    // Both blocks of the session, in block order; the warm-up keeps its own 1RM.
    expect(last?.sets).toEqual([
      expect.objectContaining({ setType: 'warm_up', weight: 140, reps: 3, volume: 420 }),
      expect.objectContaining({ setType: 'rir_1', weight: 100, reps: 5, volume: 500 }),
      expect.objectContaining({ setType: 'rir_0', weight: 90, reps: 8, volume: 720 }),
    ]);
    expect(last?.sets[0].oneRepMax).toBeCloseTo(estimateOneRepMax(140, 3) as number, 8);
    expect(last).toMatchObject({ maxWeight: 100, volume: 1220, knownVolume: 1220, volumeComplete: true });
    expect(records.maxWeight?.weight).toBe(100);
  });

  it('has no records and no Last when every session is warm-ups only', async () => {
    insertSession('s1', 1, bench(['60', '10', 'warm_up']));

    expect(await loadExerciseRecords({ exerciseDefinitionId: BENCH })).toEqual({
      records: { oneRepMax: null, maxWeight: null, volume: null },
      last: null,
    });
    expect(deriveLastSession([])).toBeNull();
  });
});

describe('exercise history all-time bests from the facts', () => {
  it('reads all time whatever the period, gym-scoped, ties to the earliest session', async () => {
    const recent = new Date();
    insertSession('old-home', 1, bench(['150', '3']), 'home');
    insertSession('old-none', 2, bench(['150', '3']));
    insertSession('later-none', 3, bench(['150', '3']));
    db().insert(sessions).values({ id: 'recent', status: 'completed', startedAt: recent, completedAt: recent }).run();
    db().insert(sessionExercises).values({ id: 'recent-b0', sessionId: 'recent', exerciseDefinitionId: BENCH, orderIndex: 0, name: 'Bench' }).run();
    db().insert(exerciseSets).values({ id: 'recent-s0', sessionExerciseId: 'recent-b0', orderIndex: 0, weightValue: '80', repsValue: '5', setType: 'rir_2' }).run();

    const history = async (gymId?: string) =>
      (await loadExercisePerformanceHistory({ exerciseDefinitionId: BENCH, period: 7, ...(gymId ? { gymId } : {}) }))!;

    const all = await history();
    expect(all.sessions.map((entry) => entry.sessionId)).toEqual(['recent']);
    expect(all.allTimeBest.topWeight).toEqual({ weight: 150, reps: 3, sessionId: 'old-home', completedAt: day(1) });
    expect(all.allTimeBest.estimatedOneRepMax).toMatchObject({ sessionId: 'old-home', completedAt: day(1) });
    expect((await history('no-gym')).allTimeBest.topWeight?.sessionId).toBe('old-none');
    expect((await history('club')).allTimeBest).toEqual({ estimatedOneRepMax: null, topWeight: null });
  });
});

describe('records from the facts equal the replay on a generated history', () => {
  // Deterministic generator (mulberry32) for a varied history.
  const random = (() => {
    let state = 0x7ec0;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)];

  const generateSet = (): SetSpec => {
    const setType = pick(['warm_up', 'rir_0', 'rir_2', null]);
    return [
      setType === 'warm_up' ? pick(['120', '140']) : pick(['60', '80', '100', '100', '102.5', '110', '', '0']),
      pick(['1', '3', '5', '5', '8', '']),
      setType,
      pick([null, null, null, 'unperformed', 'planned']),
    ];
  };

  type ReplaySet = { weight: number; reps: number; oneRepMax: number | null; volume: number | null };

  // The panel's derivation before the facts: every working set of every
  // completed session, oldest first, a value kept only when strictly beaten.
  const replayRecords = (entries: ExerciseHistorySessionEntry[]): ExerciseRecords => {
    const bySession = new Map<string, { entry: ExerciseHistorySessionEntry; sets: ReplaySet[] }>();
    for (const entry of entries) {
      const session = bySession.get(entry.sessionId) ?? { entry, sets: [] };
      for (const set of entry.sets) {
        if (!isWorkingSet({ weight: set.weightValue, reps: set.repsValue, setType: set.setType })) continue;
        const weight = parseSetWeight(canonicalizeWeightForReps(set.weightValue, set.repsValue));
        const reps = parseSetReps(set.repsValue);
        if (weight === null || reps === null) continue;
        const metric = calculateAnalyticsSetMetrics({ ...set, ...(entry.loadContext ?? ordinaryLoadContext()) });
        session.sets.push({ weight, reps, oneRepMax: metric.estimatedOneRepMaxKg, volume: metric.volumeKgReps });
      }
      bySession.set(entry.sessionId, session);
    }
    const records: ExerciseRecords = { oneRepMax: null, maxWeight: null, volume: null };
    const ordered = [...bySession.values()]
      .filter((session) => session.sets.length > 0)
      .sort((left, right) => compareFactSessionOrder(left.entry, right.entry));
    for (const { entry, sets } of ordered) {
      const where = { completedAt: entry.completedAt, gymId: entry.gymId ?? null, gymName: entry.gymName };
      for (const set of sets) {
        if (set.oneRepMax !== null && (records.oneRepMax === null || set.oneRepMax > records.oneRepMax.value)) {
          records.oneRepMax = { ...where, value: set.oneRepMax, weight: set.weight, reps: set.reps };
        }
        const max = records.maxWeight;
        if (max === null || set.weight > max.weight || (set.weight === max.weight && set.reps > max.reps)) {
          records.maxWeight = { ...where, weight: set.weight, reps: set.reps };
        }
      }
      const volume = sets.some((set) => set.volume === null)
        ? null : sets.reduce((sum, set) => sum + (set.volume as number), 0);
      if (volume !== null && (records.volume === null || volume > records.volume.value)) {
        records.volume = { ...where, value: volume, setCount: sets.length };
      }
    }
    return records;
  };

  // Volumes sum in a different order (per block); compare to 1e-9.
  const rounded = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, field: unknown) =>
    (typeof field === 'number' ? Math.round(field * 1e9) / 1e9 : field)));

  it('agrees for every gym scope and every edited session', async () => {
    const sessionIds: string[] = [];
    for (let index = 0; index < 36; index += 1) {
      const id = `gen-${String(index).padStart(2, '0')}`;
      sessionIds.push(id);
      const blocks = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({
        definitionId: pick([BENCH, BENCH, SQUAT, null]),
        sets: Array.from({ length: Math.floor(random() * 4) }, generateSet),
      }));
      insertSession(id, 1 + index, blocks, pick(['home', 'club', null]));
    }

    const history = (await loadExercisePerformanceHistory({ exerciseDefinitionId: BENCH, period: 'all' }))!.sessions;
    const target = (sessionId: string) => db().select().from(sessions).all().find((row) => row.id === sessionId)!;
    const scopes: { gymId?: string | null }[] = [{}, { gymId: 'home' }, { gymId: null }];
    let compared = 0;
    for (const scope of scopes) {
      for (const beforeSessionId of [null, ...sessionIds.filter((_, index) => index % 5 === 4)]) {
        const before = beforeSessionId ? target(beforeSessionId) : null;
        const entries = history.filter((entry) =>
          (scope.gymId === undefined || (entry.gymId ?? null) === scope.gymId) &&
          (before === null || compareFactSessionOrder(entry, { completedAt: before.completedAt!, sessionId: before.id }) < 0));

        const fromFacts = await loadExerciseRecords({ exerciseDefinitionId: BENCH, beforeSessionId, ...scope });

        expect(rounded({ scope, beforeSessionId, ...fromFacts }))
          .toEqual(rounded({ scope, beforeSessionId, records: replayRecords(entries), last: deriveLastSession(entries) }));
        compared += fromFacts.records.oneRepMax ? 1 : 0;
      }
    }
    // The generated history is not trivially empty.
    expect(compared).toBeGreaterThan(10);
  });
});
