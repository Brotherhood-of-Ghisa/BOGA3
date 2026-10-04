/**
 * Metric and PR-flag rules of the exercise session facts, as pure derivation
 * (spec 05, "Exercise session facts"). Storage, triggers and the incremental
 * drain are covered over a real database in `exercise-session-facts.test.ts`.
 */

import {
  deriveExerciseSessionFacts,
  EXERCISE_SESSION_FACTS_RULES_VERSION,
  summarizeFactSession,
  type FactsBlockInput,
  type FactsSessionInput,
  type FactsSetInput,
} from '@/src/data/exercise-session-facts-derive';
import { estimateOneRepMax } from '@/src/exercise-calculations';
import { ordinaryLoadContext, personalLoadContext } from '@/src/exercise-calculations/analytics';
import type { LoadContext } from '@/src/exercise-calculations/load-metrics';

const DEFINITION = 'bench';

type SetSpec = [weight: string, reps: string, setType?: string | null, status?: FactsSetInput['performanceStatus']];

const block = (
  id: string,
  orderIndex: number,
  sets: SetSpec[],
  loadContext: LoadContext = ordinaryLoadContext(),
): FactsBlockInput => ({
  id,
  orderIndex,
  loadContext,
  sets: sets.map(([weightValue, repsValue, setType = 'rir_2', performanceStatus = null], index) => ({
    id: `${id}-s${index}`,
    orderIndex: index,
    weightValue,
    repsValue,
    setType,
    performanceStatus,
  })),
});

const session = (id: string, day: number, blocks: FactsBlockInput[]): FactsSessionInput => ({
  sessionId: id,
  completedAt: new Date(Date.UTC(2026, 0, day, 18)),
  blocks,
});

const flags = (rows: ReturnType<typeof deriveExerciseSessionFacts>) =>
  rows.map(({ sessionId, prE1rm, prWeight, prVolume }) => ({ sessionId, prE1rm, prWeight, prVolume }));

describe('exercise session facts — metrics', () => {
  it('takes 1RM, top weight, volume and working sets from working sets only', () => {
    const bests = summarizeFactSession(DEFINITION, session('s1', 1, [
      block('b1', 0, [
        ['120', '3', 'warm_up'], // heavier than every working set, yet never a best
        ['100', '5'],
        ['100', '5', 'rir_2', 'planned'], // not performed
        ['', ''], // not a set
      ]),
    ]));

    expect(bests).toEqual({
      sessionId: 's1',
      exerciseDefinitionId: DEFINITION,
      achievedAt: new Date(Date.UTC(2026, 0, 1, 18)),
      bestE1rmKg: estimateOneRepMax(100, 5),
      bestE1rmSetId: 'b1-s1',
      topWeightKg: 100,
      topWeightSetId: 'b1-s1',
      topWeightReps: 5,
      volumeKg: 100 * 5,
      volumeComplete: true,
      workingSets: 1,
      volumeSets: 1,
    });
  });

  it('gives a session with only warm-ups for the definition no row', () => {
    const warmUpOnly = session('s2', 2, [block('b1', 0, [['140', '2', 'warm_up'], ['120', '3', 'warm_up']])]);

    expect(summarizeFactSession(DEFINITION, warmUpOnly)).toBeNull();
    expect(deriveExerciseSessionFacts(DEFINITION, [
      session('s1', 1, [block('a1', 0, [['100', '5']])]),
      warmUpOnly,
    ]).map((row) => row.sessionId)).toEqual(['s1']);
  });

  it('never lets a heavier warm-up raise the PR bars', () => {
    const rows = deriveExerciseSessionFacts(DEFINITION, [
      session('s1', 1, [block('a1', 0, [['200', '5', 'warm_up'], ['100', '5']])]),
      session('s2', 2, [block('b1', 0, [['105', '5']])]),
    ]);

    expect(rows.map(({ sessionId, prE1rm, prWeight, prVolume }) => ({ sessionId, prE1rm, prWeight, prVolume })))
      .toEqual([
        { sessionId: 's1', prE1rm: false, prWeight: false, prVolume: false },
        { sessionId: 's2', prE1rm: true, prWeight: true, prVolume: true },
      ]);
  });

  it('folds repeated blocks into one row and breaks ties in session order (block, then set)', () => {
    // Block 1 set 2 and block 2 set 1 tie on 1RM. Session order puts block 1 first.
    const bests = summarizeFactSession(DEFINITION, session('s1', 1, [
      block('b2', 1, [['100', '5'], ['50', '5']]),
      block('b1', 0, [['80', '5'], ['100', '5']]),
    ]));

    expect(bests).toMatchObject({
      bestE1rmSetId: 'b1-s1',
      topWeightSetId: 'b1-s1',
      volumeKg: 80 * 5 + 100 * 5 + 100 * 5 + 50 * 5,
      workingSets: 4,
    });
  });

  it('gives an equal top weight to the set with more reps', () => {
    const bests = summarizeFactSession(DEFINITION, session('s1', 1, [
      block('b1', 0, [['100', '3'], ['100', '5'], ['100', '5']]),
    ]));

    expect(bests).toMatchObject({ topWeightKg: 100, topWeightSetId: 'b1-s1' });
  });

  it('uses the personal calculation policy for 1RM and volume but raw kg for top weight', () => {
    const personal = personalLoadContext(true, { bodyweightContribution: 1, loadInputMode: 'total_load' }, {
      bodyWeightKg: 80,
      bodyWeightSource: 'reading',
      bodyWeightMeasurementId: 'w1',
      bodyWeightMeasuredAt: new Date(0),
    });
    const bests = summarizeFactSession(DEFINITION, session('s1', 1, [block('b1', 0, [['10', '5']], personal)]));

    // 1RM excludes the bodyweight part again; volume counts calculated load.
    expect(bests).toMatchObject({ topWeightKg: 10, volumeKg: 90 * 5, volumeComplete: true });
    expect(bests?.bestE1rmKg).toBeCloseTo((estimateOneRepMax(90, 5) as number) - 80);
  });

  it('marks volume incomplete when a set has no calculated load and keeps the known subtotal', () => {
    const missing: LoadContext = { policy: 'group', bodyweightContribution: 1, loadInputMode: 'total_load', bodyWeightKg: null };
    const bests = summarizeFactSession(DEFINITION, session('s1', 1, [
      block('b1', 0, [['100', '5']]),
      block('b2', 1, [['10', '5']], missing),
    ]));

    expect(bests).toMatchObject({ volumeKg: 500, volumeComplete: false, topWeightKg: 100, workingSets: 2 });
  });

  it('has no row for a session without an eligible set', () => {
    expect(summarizeFactSession(DEFINITION, session('s1', 1, [
      block('b1', 0, [['100', '5', 'rir_2', 'unperformed'], ['', '']]),
    ]))).toBeNull();
    expect(deriveExerciseSessionFacts(DEFINITION, [session('s1', 1, [block('b1', 0, [])])])).toEqual([]);
  });
});

describe('exercise session facts — PR flags', () => {
  it('flags nothing on the first session: it is the baseline', () => {
    expect(flags(deriveExerciseSessionFacts(DEFINITION, [session('s1', 1, [block('b1', 0, [['100', '5']])])])))
      .toEqual([{ sessionId: 's1', prE1rm: false, prWeight: false, prVolume: false }]);
  });

  it('flags a metric only when it strictly beats every earlier session', () => {
    const rows = deriveExerciseSessionFacts(DEFINITION, [
      // Out of order on purpose: history order is completed_at, then session id.
      session('s3', 3, [block('c1', 0, [['105', '5']])]),
      session('s1', 1, [block('a1', 0, [['100', '5']])]),
      session('s2', 2, [block('b1', 0, [['100', '5']])]), // ties s1
    ]);

    expect(flags(rows)).toEqual([
      { sessionId: 's1', prE1rm: false, prWeight: false, prVolume: false },
      { sessionId: 's2', prE1rm: false, prWeight: false, prVolume: false },
      { sessionId: 's3', prE1rm: true, prWeight: true, prVolume: true },
    ]);
  });

  it('orders sessions completed at the same instant by session id', () => {
    const rows = deriveExerciseSessionFacts(DEFINITION, [
      session('s-b', 1, [block('b1', 0, [['110', '5']])]),
      session('s-a', 1, [block('a1', 0, [['100', '5']])]),
    ]);

    expect(flags(rows)).toEqual([
      { sessionId: 's-a', prE1rm: false, prWeight: false, prVolume: false },
      { sessionId: 's-b', prE1rm: true, prWeight: true, prVolume: true },
    ]);
  });

  it('flags each metric independently and points at one set per metric', () => {
    const rows = deriveExerciseSessionFacts(DEFINITION, [
      session('s1', 1, [block('a1', 0, [['100', '5'], ['100', '5'], ['100', '5']])]),
      // Two qualifying sets: one heavier single, one stronger 1RM set.
      session('s2', 2, [block('b1', 0, [['110', '1'], ['105', '5']])]),
    ]);

    expect(rows[1]).toMatchObject({
      prE1rm: true,
      bestE1rmSetId: 'b1-s1',
      prWeight: true,
      topWeightSetId: 'b1-s0',
      prVolume: false,
    });
  });

  it('never makes an incomplete volume a PR or lets it raise the bar', () => {
    const missing: LoadContext = { policy: 'group', bodyweightContribution: 1, loadInputMode: 'total_load', bodyWeightKg: null };
    const rows = deriveExerciseSessionFacts(DEFINITION, [
      session('s1', 1, [block('a1', 0, [['100', '10']])]), // 1000
      session('s2', 2, [block('b1', 0, [['100', '50']]), block('b2', 1, [['1', '1']], missing)]), // 5000 known, incomplete
      session('s3', 3, [block('c1', 0, [['100', '15']])]), // 1500 beats 1000
    ]);

    expect(rows.map((row) => [row.volumeKg, row.volumeComplete, row.prVolume])).toEqual([
      [1000, true, false],
      [5000, false, false],
      [1500, true, true],
    ]);
  });

  it('skips sessions without a value when setting the baseline', () => {
    const missing: LoadContext = { policy: 'group', bodyweightContribution: 1, loadInputMode: 'total_load', bodyWeightKg: null };
    const rows = deriveExerciseSessionFacts(DEFINITION, [
      // No 1RM (load missing) but a raw top weight.
      session('s1', 1, [block('a1', 0, [['100', '5']], missing)]),
      session('s2', 2, [block('b1', 0, [['90', '5']])]),
      session('s3', 3, [block('c1', 0, [['95', '5']])]),
    ]);

    expect(rows.map((row) => [row.sessionId, row.bestE1rmKg === null, row.prE1rm, row.prWeight])).toEqual([
      ['s1', true, false, false],
      ['s2', false, false, false], // the first 1RM is the 1RM baseline
      ['s3', false, true, false], // 95 does not beat s1's raw 100
    ]);
  });
});

describe('exercise session facts — rules version', () => {
  // Stored facts are rebuilt only when EXERCISE_SESSION_FACTS_RULES_VERSION
  // changes. These literals pin what today's rules derive, including the shared
  // kernel (1RM formula, set eligibility, working-set rule). If this test
  // fails, a rule changed: bump the version, then update the literals.
  it('pins the derived values the current rules version stands for', () => {
    expect(EXERCISE_SESSION_FACTS_RULES_VERSION).toBe(5);
    const rows = deriveExerciseSessionFacts(DEFINITION, [
      session('s1', 1, [block('a1', 0, [['100', '5', 'rir_3'], ['60', '10', 'warm_up'], ['90', '8', 'rir_4']])]),
      session('s2', 2, [block('b1', 0, [['', '12', 'rir_0'], ['102.5', '5', null], ['110', '1', 'rir_1', 'planned'], ['130', '2', 'warm_up']])]),
      session('s3', 3, [block('c1', 0, [['140', '1', 'warm_up']])]),
      // Version 4: the Weight record is the pair, so more reps at 102.5 is one.
      session('s4', 4, [block('d1', 0, [['102.5', '6', 'rir_0']])]),
    ]);

    expect(rows.map(({ achievedAt: _achievedAt, bestE1rmKg, volumeKg, ...row }) => ({
      ...row,
      bestE1rmKg: Number(bestE1rmKg?.toFixed(4)),
      volumeKg,
    }))).toEqual([
      {
        sessionId: 's1', exerciseDefinitionId: DEFINITION, bestE1rmKg: 116.5825, bestE1rmSetId: 'a1-s0',
        topWeightKg: 100, topWeightSetId: 'a1-s0', volumeKg: 1220, volumeComplete: true, workingSets: 2, volumeSets: 2,
        prE1rm: false, prWeight: false, prVolume: false,
      },
      {
        sessionId: 's2', exerciseDefinitionId: DEFINITION, bestE1rmKg: 119.4971, bestE1rmSetId: 'b1-s1',
        topWeightKg: 102.5, topWeightSetId: 'b1-s1', volumeKg: 512.5, volumeComplete: true, workingSets: 2, volumeSets: 2,
        prE1rm: true, prWeight: true, prVolume: false,
      },
      {
        sessionId: 's4', exerciseDefinitionId: DEFINITION, bestE1rmKg: 123.3388, bestE1rmSetId: 'd1-s0',
        topWeightKg: 102.5, topWeightSetId: 'd1-s0', volumeKg: 615, volumeComplete: true, workingSets: 1, volumeSets: 1,
        prE1rm: true, prWeight: true, prVolume: false,
      },
    ]);
  });
});
