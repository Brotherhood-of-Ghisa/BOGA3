/**
 * Exercise session facts over a real, fully migrated database (spec 05,
 * "Exercise session facts"): the triggers queue every write path, a read
 * drains the queue first, and the incremental result always equals a full
 * rebuild from the raw rows (the oracle). The 1RM flags, and the
 * completed-session PR list read from the facts, must equal the replay
 * `deriveSessionPersonalRecords` on every session.
 *
 * Metric and flag rules themselves are pure and live in
 * `exercise-session-facts-derive.test.ts`.
 */
/* eslint-disable import/first */

import { asc, eq } from 'drizzle-orm';

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

import { deleteBodyWeightReading, saveBodyWeightReading } from '@/src/data/bodyweight';
import type { LocalDatabase } from '@/src/data/bootstrap';
import { __resetClockForTests, type Transaction } from '@/src/data/clock';
import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import {
  drainExerciseSessionFacts,
  loadEarlierBestE1rmByDefinition,
  loadExerciseSessionFacts,
  loadFlaggedExerciseSessionFacts,
  rebuildAllExerciseSessionFacts,
  type ExerciseSessionFactRow,
} from '@/src/data/exercise-session-facts';
import { EXERCISE_SESSION_FACTS_RULES_VERSION } from '@/src/data/exercise-session-facts-derive';
import {
  exerciseDefinitions,
  exerciseSessionFacts,
  exerciseSessionFactsStale,
  exerciseSessionFactsState,
  exerciseSets,
  muscleGroups,
  sessionExercises,
  sessions,
  userSettings,
} from '@/src/data/schema';
import {
  completeSessionDraft,
  loadSessionSnapshotById,
  persistCompletedSessionSnapshot,
  persistSessionDraftSnapshot,
} from '@/src/data/session-drafts';
import { setSessionDeletedState } from '@/src/data/session-list';
import { writeBodyweightCalculationsEnabled } from '@/src/data/user-settings';
import { deriveSessionPersonalRecords, loadCompletedSessionInsights, loadSessionInsightHistory } from '@/src/session-insights';
import { applyPullPage, entityToWire } from '@/src/sync/cycle';

const BENCH = 'def-bench';
const SQUAT = 'def-squat';
const DIP = 'def-dip'; // bodyweight contribution 1
const day = (n: number, hour = 18) => new Date(Date.UTC(2026, 0, n, hour));

type SetSpec = [weight: string, reps: string, setType?: string | null, status?: string | null];
type BlockSpec = { id?: string; definitionId: string | null; sets: SetSpec[] };

let fixture: InMemoryDatabaseFixture;
const db = () => fixture.database;
const asLocal = () => fixture.database as unknown as LocalDatabase;

const insertSession = (
  id: string,
  dayNumber: number,
  blocks: BlockSpec[],
  options: { status?: 'active' | 'completed'; deletedAt?: Date } = {},
) => {
  const status = options.status ?? 'completed';
  db().insert(sessions).values({
    id,
    status,
    startedAt: day(dayNumber, 17),
    completedAt: status === 'completed' ? day(dayNumber) : null,
    deletedAt: options.deletedAt ?? null,
  }).run();
  blocks.forEach((block, blockIndex) => {
    const blockId = block.id ?? `${id}-b${blockIndex}`;
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

const allFacts = (): ExerciseSessionFactRow[] => db().select().from(exerciseSessionFacts)
  .orderBy(asc(exerciseSessionFacts.exerciseDefinitionId), asc(exerciseSessionFacts.achievedAt), asc(exerciseSessionFacts.sessionId))
  .all();
const queued = () => db().select().from(exerciseSessionFactsStale).all()
  .map((row) => row.exerciseDefinitionId).sort();
const fullRebuild = () => db().transaction((tx) => { rebuildAllExerciseSessionFacts(tx as unknown as Transaction); });

/** The oracle: the incremental drain must leave exactly what a full rebuild builds. */
const expectIncrementalEqualsFullRebuild = (expectedQueue: string[]) => {
  expect(queued()).toEqual([...expectedQueue].sort());
  const drain = drainExerciseSessionFacts(asLocal());
  expect(drain).toMatchObject({ kind: 'incremental', definitions: expectedQueue.length });
  const incremental = allFacts();
  fullRebuild();
  expect(allFacts()).toEqual(incremental);
  return incremental;
};

const factFor = (sessionId: string, definitionId: string) =>
  allFacts().find((row) => row.sessionId === sessionId && row.exerciseDefinitionId === definitionId);

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase();
  mockActiveDatabase = fixture.database;
  db().insert(exerciseDefinitions).values([
    { id: BENCH, name: 'Bench Press' },
    { id: SQUAT, name: 'Squat' },
    { id: DIP, name: 'Dip', bodyweightContribution: 1 },
  ]).run();
});

afterEach(() => {
  fixture.close();
  mockActiveDatabase = null;
});

describe('exercise session facts — rows and reads', () => {
  it('builds rows only for linked exercises in completed, non-deleted sessions', async () => {
    insertSession('s1', 1, [
      { definitionId: BENCH, sets: [['100', '5']] },
      { definitionId: null, sets: [['60', '10']] }, // unlinked legacy exercise
      { definitionId: SQUAT, sets: [['140', '5', 'rir_2', 'unperformed']] }, // nothing performed
    ]);
    insertSession('s-deleted', 2, [{ definitionId: BENCH, sets: [['200', '5']] }], { deletedAt: day(3) });
    insertSession('s-active', 3, [{ definitionId: BENCH, sets: [['200', '5']] }], { status: 'active' });

    const rows = await loadExerciseSessionFacts(BENCH);

    expect(rows.map((row) => row.sessionId)).toEqual(['s1']);
    expect(allFacts().map((row) => `${row.sessionId}:${row.exerciseDefinitionId}`)).toEqual(['s1:def-bench']);
  });

  it('builds the whole table on the first read, then serves it until a write queues a definition', async () => {
    insertSession('s1', 1, [{ definitionId: BENCH, sets: [['100', '5']] }]);
    expect(db().select().from(exerciseSessionFactsState).all()).toEqual([]);

    expect(drainExerciseSessionFacts(asLocal())).toEqual({ kind: 'full', rows: 1 });
    expect(db().select().from(exerciseSessionFactsState).all()).toEqual([{ id: 'facts', rulesVersion: EXERCISE_SESSION_FACTS_RULES_VERSION }]);
    expect(queued()).toEqual([]);
    expect(drainExerciseSessionFacts(asLocal())).toEqual({ kind: 'fresh' });
  });

  it('rebuilds everything once when the table was built under other rules', () => {
    insertSession('s1', 1, [{ definitionId: BENCH, sets: [['100', '5']] }]);
    drainExerciseSessionFacts(asLocal());
    db().update(exerciseSessionFactsState).set({ rulesVersion: 0 }).run();
    db().delete(exerciseSessionFacts).run();

    expect(drainExerciseSessionFacts(asLocal())).toEqual({ kind: 'full', rows: 1 });
    expect(allFacts()).toHaveLength(1);
  });

  it('reads one definition in history order and flagged rows inside a half-open window', async () => {
    insertSession('s1', 1, [{ definitionId: BENCH, sets: [['100', '5']] }, { definitionId: SQUAT, sets: [['100', '5']] }]);
    insertSession('s2', 2, [{ definitionId: BENCH, sets: [['105', '5']] }, { definitionId: SQUAT, sets: [['90', '5']] }]);
    insertSession('s3', 3, [{ definitionId: SQUAT, sets: [['120', '5']] }]);

    expect((await loadExerciseSessionFacts(BENCH)).map((row) => [row.sessionId, row.prE1rm]))
      .toEqual([['s1', false], ['s2', true]]);
    expect((await loadFlaggedExerciseSessionFacts({ from: day(2), to: day(3) }))
      .map((row) => `${row.sessionId}:${row.exerciseDefinitionId}`)).toEqual(['s2:def-bench']);
    expect((await loadFlaggedExerciseSessionFacts({ from: day(1), to: day(4) }))
      .map((row) => `${row.sessionId}:${row.exerciseDefinitionId}`)).toEqual(['s2:def-bench', 's3:def-squat']);
  });

  it('returns same-instant sessions in the order the flags were derived in', async () => {
    // localeCompare puts 'a…' before 'B…'; SQLite's BINARY order would not.
    insertSession('a-session', 1, [{ definitionId: BENCH, sets: [['100', '5']] }]);
    insertSession('B-session', 1, [{ definitionId: BENCH, sets: [['110', '5']] }]);

    expect((await loadExerciseSessionFacts(BENCH)).map((row) => [row.sessionId, row.prE1rm]))
      .toEqual([['a-session', false], ['B-session', true]]);
    expect((await loadFlaggedExerciseSessionFacts({ from: day(0), to: day(9) })).map((row) => row.sessionId))
      .toEqual(['B-session']);
  });

  it('reads each definition\'s best 1RM strictly before a session, same-instant ties in derivation order', async () => {
    // localeCompare: 'a-early' < 'B-target' < 'c-same'; 'c-same' shares the target's instant but comes after it.
    insertSession('a-early', 1, [{ definitionId: BENCH, sets: [['100', '5'], ['120', '1']] }]);
    insertSession('B-target', 1, [{ definitionId: BENCH, sets: [['110', '5']] }, { definitionId: SQUAT, sets: [['140', '5']] }]);
    insertSession('c-same', 1, [{ definitionId: BENCH, sets: [['200', '5']] }]);
    insertSession('later', 2, [{ definitionId: BENCH, sets: [['300', '5']] }]);
    insertSession('gone', 0, [{ definitionId: SQUAT, sets: [['300', '5']] }], { deletedAt: day(5) });
    insertSession('zero', 0, [{ definitionId: SQUAT, sets: [['0', '5']] }]); // a 0 kg 1RM is still a bar

    const best = await loadEarlierBestE1rmByDefinition({ sessionId: 'B-target', completedAt: day(1) }, [BENCH, SQUAT, DIP]);

    expect(new Map(best)).toEqual(new Map([[BENCH, factFor('a-early', BENCH)!.bestE1rmKg], [SQUAT, 0]]));
    // A row with eligible sets but no 1RM (an unavailable load) sets no bar.
    db().insert(exerciseSessionFacts).values({
      sessionId: 'a-early', exerciseDefinitionId: DIP, achievedAt: day(1), bestE1rmKg: null,
      volumeComplete: false, workingSets: 1, prE1rm: false, prWeight: false, prVolume: false,
    }).run();
    expect(await loadEarlierBestE1rmByDefinition({ sessionId: 'B-target', completedAt: day(1) }, [DIP])).toEqual(new Map());
    expect(await loadEarlierBestE1rmByDefinition({ sessionId: 'a-early', completedAt: day(1) }, [BENCH])).toEqual(new Map());
    expect(await loadEarlierBestE1rmByDefinition({ sessionId: 'B-target', completedAt: day(1) }, [])).toEqual(new Map());
  });

  it('never serves a row whose session is gone, even before the drain catches up', async () => {
    insertSession('s1', 1, [{ definitionId: BENCH, sets: [['100', '5']] }]);
    drainExerciseSessionFacts(asLocal());
    // A row left behind by a raw delete with the queue cleared: reads still join live sessions.
    db().delete(sessions).where(eq(sessions.id, 's1')).run();
    db().delete(exerciseSessionFactsStale).run();
    db().insert(exerciseSessionFacts).values({
      sessionId: 's1', exerciseDefinitionId: BENCH, achievedAt: day(1),
      volumeComplete: true, workingSets: 1, prE1rm: true, prWeight: false, prVolume: false,
    }).onConflictDoNothing().run();

    expect(await loadExerciseSessionFacts(BENCH)).toEqual([]);
    expect(await loadFlaggedExerciseSessionFacts({ from: day(0), to: day(9) })).toEqual([]);
  });
});

describe('exercise session facts — incremental maintenance equals a full rebuild', () => {
  beforeEach(() => {
    insertSession('s1', 1, [{ id: 's1-bench', definitionId: BENCH, sets: [['100', '5'], ['100', '5']] }]);
    insertSession('s2', 3, [{ id: 's2-bench', definitionId: BENCH, sets: [['102.5', '5']] }, { definitionId: SQUAT, sets: [['140', '5']] }]);
    insertSession('s3', 5, [{ id: 's3-bench', definitionId: BENCH, sets: [['105', '5']] }, { definitionId: DIP, sets: [['10', '8']] }]);
    insertSession('s4', 7, [{ definitionId: DIP, sets: [['20', '6']] }]);
    drainExerciseSessionFacts(asLocal());
    expect(queued()).toEqual([]);
  });

  it('completion: recording an active session queues nothing; completing it queues its definitions', async () => {
    const { sessionId } = await persistSessionDraftSnapshot({
      gymId: null,
      startedAt: day(9, 17),
      exercises: [{ exerciseDefinitionId: BENCH, name: 'Bench Press', sets: [{ weightValue: '110', repsValue: '5', setType: 'rir_1', performanceStatus: null }] }],
    }, { now: day(9, 17) });
    expect(queued()).toEqual([]);

    await completeSessionDraft(sessionId, { now: day(9) });

    expectIncrementalEqualsFullRebuild([BENCH]);
    expect(factFor(sessionId, BENCH)).toMatchObject({ prE1rm: true, prWeight: true, topWeightKg: 110 });
  });

  it('completed-edit: changing an older set recomputes later flags', async () => {
    const snapshot = await loadSessionSnapshotById('s1');
    await persistCompletedSessionSnapshot({
      sessionId: 's1',
      gymId: null,
      startedAt: day(1, 17),
      completedAt: day(1),
      exercises: snapshot!.exercises.map((exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set, index) => (index === 0 ? { ...set, weightValue: '110' } : set)),
      })),
    }, { now: day(10) });

    expectIncrementalEqualsFullRebuild([BENCH]);
    expect([factFor('s2', BENCH)?.prWeight, factFor('s3', BENCH)?.prWeight]).toEqual([false, false]);
  });

  it('backdating completed_at reorders the history', async () => {
    const snapshot = await loadSessionSnapshotById('s3');
    await persistCompletedSessionSnapshot({
      sessionId: 's3', gymId: null, startedAt: day(0, 17), completedAt: day(0), exercises: snapshot!.exercises,
    }, { now: day(10) });

    expectIncrementalEqualsFullRebuild([BENCH, DIP]);
    expect(factFor('s3', BENCH)).toMatchObject({ achievedAt: day(0), prE1rm: false });
    expect(factFor('s4', DIP)).toMatchObject({ prWeight: true });
  });

  it('delete and undelete from the session list', async () => {
    await setSessionDeletedState('s1', true, { now: day(10) });
    expectIncrementalEqualsFullRebuild([BENCH]);
    expect(factFor('s1', BENCH)).toBeUndefined();
    expect(factFor('s2', BENCH)?.prE1rm).toBe(false); // now the baseline

    await setSessionDeletedState('s1', false, { now: day(11) });
    expectIncrementalEqualsFullRebuild([BENCH]);
    expect(factFor('s2', BENCH)?.prE1rm).toBe(true);
  });

  it('relinking a session exercise to another definition', async () => {
    const snapshot = await loadSessionSnapshotById('s2');
    await persistCompletedSessionSnapshot({
      sessionId: 's2', gymId: null, startedAt: day(3, 17), completedAt: day(3),
      exercises: snapshot!.exercises.map((exercise) =>
        exercise.exerciseDefinitionId === SQUAT ? { ...exercise, exerciseDefinitionId: DIP } : exercise),
    }, { now: day(10) });

    // The completed-edit save rewrites every block of the session, so Bench is queued too.
    expectIncrementalEqualsFullRebuild([BENCH, SQUAT, DIP]);
    expect(factFor('s2', SQUAT)).toBeUndefined();
    expect(factFor('s2', DIP)).toMatchObject({ topWeightKg: 140 });
  });

  it('pull-apply of a newer set from another device', () => {
    const row = db().select().from(exerciseSets).where(eq(exerciseSets.id, 's1-bench-s0')).get()!;
    const wire = entityToWire(row as never, 'exercise_sets');
    db().transaction((tx) => {
      applyPullPage(tx as unknown as Transaction, [{
        ...wire,
        client_updated_at_ms: row.localUpdatedAtMs + 1_000,
        fields: { ...wire.fields, weight_value: '120' },
      }], 'exercise_sets');
    });

    expectIncrementalEqualsFullRebuild([BENCH]);
    expect(factFor('s1', BENCH)?.topWeightKg).toBe(120);
  });

  it('a bodyweight toggle and a reading change rebuild the bodyweight exercises', async () => {
    await saveBodyWeightReading({ weightValue: '80', measuredAt: day(0), now: day(10) });
    expect(queued()).toEqual([]); // calculations are off: readings change nothing

    await writeBodyweightCalculationsEnabled(true);
    const enabled = expectIncrementalEqualsFullRebuild([DIP]);
    expect(enabled.find((row) => row.sessionId === 's4')?.volumeKg).toBe(100 * 6);

    await saveBodyWeightReading({ weightValue: '90', measuredAt: day(6), now: day(10) });
    expectIncrementalEqualsFullRebuild([DIP]);
    expect(factFor('s4', DIP)?.volumeKg).toBe(110 * 6);
  });

  it('a contribution or load-mode edit rebuilds that definition', async () => {
    db().insert(muscleGroups).values({ id: 'chest', displayName: 'Chest', familyName: 'Chest' }).run();
    const mappings = [{ muscleGroupId: 'chest', weight: 1, role: 'primary' as const }];
    await saveExerciseCatalogExercise({
      id: BENCH, name: 'Bench Press', loadInputMode: 'per_side_load', mappings, now: day(10),
    });

    expectIncrementalEqualsFullRebuild([BENCH]);

    await writeBodyweightCalculationsEnabled(true);
    drainExerciseSessionFacts(asLocal());
    await saveExerciseCatalogExercise({
      id: SQUAT, name: 'Squat', bodyweightContribution: 0.5, mappings, now: day(11),
    });

    expectIncrementalEqualsFullRebuild([SQUAT]);
  });

  it('a hard delete (dev reset, wipe) queues the definitions it removes', () => {
    db().delete(sessions).where(eq(sessions.id, 's2')).run();

    expectIncrementalEqualsFullRebuild([BENCH, SQUAT]);
    expect(factFor('s2', BENCH)).toBeUndefined();
  });

  it('hard-deleting one set, deleting a reading, and undeleting a block', async () => {
    db().delete(exerciseSets).where(eq(exerciseSets.id, 's3-bench-s0')).run();
    expectIncrementalEqualsFullRebuild([BENCH]);
    expect(factFor('s3', BENCH)).toBeUndefined();

    await writeBodyweightCalculationsEnabled(true);
    const reading = await saveBodyWeightReading({ weightValue: '80', measuredAt: day(0), now: day(10) });
    drainExerciseSessionFacts(asLocal());
    await deleteBodyWeightReading(reading.id, day(11));
    expectIncrementalEqualsFullRebuild([DIP]);
    expect(factFor('s4', DIP)?.volumeKg).toBe(20 * 6);

    db().update(sessionExercises).set({ deletedAt: day(12) }).where(eq(sessionExercises.id, 's2-bench')).run();
    expectIncrementalEqualsFullRebuild([BENCH]);
    db().update(sessionExercises).set({ deletedAt: null }).where(eq(sessionExercises.id, 's2-bench')).run();
    expectIncrementalEqualsFullRebuild([BENCH]);
    expect(factFor('s2', BENCH)?.prE1rm).toBe(true);
  });

  it('turning bodyweight calculations off queues the bodyweight exercises', async () => {
    await writeBodyweightCalculationsEnabled(true);
    drainExerciseSessionFacts(asLocal());
    await writeBodyweightCalculationsEnabled(false);
    expectIncrementalEqualsFullRebuild([DIP]);

    await writeBodyweightCalculationsEnabled(true);
    drainExerciseSessionFacts(asLocal());
    db().delete(userSettings).run();
    expectIncrementalEqualsFullRebuild([DIP]);
  });

  it('ignores writes that change nothing the facts read', () => {
    db().update(exerciseSets).set({ localDirty: false, plannedWeightValue: '50' }).run();
    db().update(sessions).set({ durationSec: 60 }).run();
    db().update(sessionExercises).set({ name: 'Renamed' }).run();
    db().update(exerciseDefinitions).set({ name: 'Renamed' }).run();

    expect(queued()).toEqual([]);
  });
});

describe('exercise session facts — 1RM flags and completed-session PRs equal deriveSessionPersonalRecords', () => {
  // Deterministic generator (mulberry32) for a varied history.
  const random = (() => {
    let state = 0x5eed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)];

  // Warm-ups are heavier than any working set, so one that counted would win.
  const generateSet = (): SetSpec => {
    const setType = pick(['warm_up', 'rir_0', 'rir_2', 'rir_4', null]);
    return [
      setType === 'warm_up' ? pick(['120', '140', '160']) : pick(['60', '80', '80', '100', '100', '102.5', '110', '', '0']),
      pick(['1', '3', '5', '5', '8', '']),
      setType,
      pick([null, null, null, null, 'unperformed', 'planned']),
    ];
  };

  it('agrees on every session of a generated history, with ties and repeated blocks', async () => {
    db().insert(exerciseDefinitions).values({ id: 'def-row', name: 'Row', loadInputMode: 'per_side_load' }).run();
    await writeBodyweightCalculationsEnabled(true);
    await saveBodyWeightReading({ weightValue: '80', measuredAt: day(1), now: day(60) });
    await saveBodyWeightReading({ weightValue: '84', measuredAt: day(20), now: day(60) });

    const sessionIds: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const id = `gen-${String(index).padStart(2, '0')}`;
      sessionIds.push(id);
      const blocks = Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({
        definitionId: pick([BENCH, BENCH, SQUAT, DIP, 'def-row', null]),
        sets: Array.from({ length: Math.floor(random() * 4) }, generateSet),
      }));
      // Some sessions share a completion day; ties then fall to the session id.
      insertSession(id, 2 + Math.floor(index * 0.8), blocks);
    }

    // A cross-block tie: block 1 set 2 and block 2 set 1 tie, and session order picks block 1.
    insertSession('gen-tie', 60, [
      { definitionId: BENCH, sets: [['80', '5'], ['130', '5']] },
      { definitionId: BENCH, sets: [['130', '5']] },
    ]);
    sessionIds.push('gen-tie');
    // A warm-up far above every earlier best is neither the session's best nor a PR.
    insertSession('gen-warm', 61, [{ definitionId: BENCH, sets: [['300', '5', 'warm_up'], ['60', '5']] }]);
    sessionIds.push('gen-warm');

    drainExerciseSessionFacts(asLocal());
    expect(factFor('gen-tie', BENCH)).toMatchObject({ prE1rm: true, bestE1rmSetId: 'gen-tie-b0-s1' });
    expect(factFor('gen-warm', BENCH)).toMatchObject({ prE1rm: false, prWeight: false, bestE1rmSetId: 'gen-warm-b0-s1', topWeightKg: 60 });
    const flagged = allFacts().filter((row) => row.prE1rm);
    expect(flagged.length).toBeGreaterThan(3);

    // Every completed graph once; the replay itself skips sessions not before its target.
    const graphs = await loadSessionInsightHistory({ completedAt: day(365), targetSessionId: '' });
    for (const sessionId of sessionIds) {
      const replayed = deriveSessionPersonalRecords({
        targetSession: graphs.find((graph) => graph.sessionId === sessionId)!,
        historicalSessions: graphs,
      });
      const insights = await loadCompletedSessionInsights(sessionId);
      // The facts-backed list is the replay's list: same sets, order and values.
      expect({ sessionId, records: insights!.personalRecords }).toEqual({ sessionId, records: replayed });
      const flags = flagged.filter((row) => row.sessionId === sessionId)
        .map((row) => `${row.exerciseDefinitionId}:${row.bestE1rmSetId}`).sort();
      const replayedSets = replayed.map((record) => `${record.exerciseDefinitionId}:${record.setId}`).sort();
      expect({ sessionId, records: flags }).toEqual({ sessionId, records: replayedSets });
    }
  });
});
