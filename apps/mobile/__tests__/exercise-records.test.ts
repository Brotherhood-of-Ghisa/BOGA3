/**
 * The records panel's derivation (`ux-rules` §14a.4): all-time records and the
 * previous session count working sets only, while `Last` keeps a warm-up's own
 * line.
 */
import type { ExerciseHistorySessionEntry } from '@/src/data/exercise-history';
import type { SessionSetTypeValue } from '@/src/data/set-types';
import { estimateOneRepMax } from '@/src/exercise-calculations';
import { deriveExerciseRecords, recordBaselineOf } from '@/src/session-recorder/exercise-records';

type SetSpec = [weight: string, reps: string, setType: SessionSetTypeValue];

const entry = (sessionId: string, day: number, sets: SetSpec[]): ExerciseHistorySessionEntry => ({
  sessionId,
  sessionExerciseId: `${sessionId}-exercise`,
  completedAt: new Date(Date.UTC(2026, 8, day, 18)),
  gymName: null,
  bodyWeightKg: null,
  bodyWeightSource: null,
  bodyWeightMeasurementId: null,
  bodyWeightMeasuredAt: null,
  tagIds: [],
  sets: sets.map(([weightValue, repsValue, setType], index) => ({
    setId: `${sessionId}-s${index}`,
    orderIndex: index,
    weightValue,
    repsValue,
    setType,
    isWorking: setType !== 'warm_up',
  })),
  workingSetCount: 0,
  estimatedOneRepMax: null,
  totalVolume: null,
  topWeightSet: null,
});

describe('exercise records', () => {
  it('never takes a warm-up heavier than the working sets as a record or a baseline', () => {
    const { records } = deriveExerciseRecords([
      entry('s1', 1, [['200', '5', 'warm_up'], ['100', '5', 'rir_2'], ['90', '8', null]]),
    ]);

    expect(records.oneRepMax).toMatchObject({ weight: 100, reps: 5 });
    expect(records.oneRepMax?.value).toBeCloseTo(estimateOneRepMax(100, 5) as number, 8);
    expect(records.maxWeight).toMatchObject({ weight: 100, reps: 5 });
    expect(records.volume).toMatchObject({ value: 100 * 5 + 90 * 8, setCount: 2 });
    expect(recordBaselineOf(records)).toEqual({ oneRepMax: records.oneRepMax!.value, weight: 100 });
  });

  it('keeps a warm-up line in Last while its summary reads working sets only', () => {
    const { last } = deriveExerciseRecords([
      entry('s1', 1, [['80', '5', 'rir_1']]),
      entry('s2', 2, [['140', '3', 'warm_up'], ['100', '5', 'rir_1']]),
    ]);

    expect(last?.completedAt).toEqual(new Date(Date.UTC(2026, 8, 2, 18)));
    expect(last?.sets).toEqual([
      expect.objectContaining({ setType: 'warm_up', weight: 140, reps: 3, volume: 420 }),
      expect.objectContaining({ setType: 'rir_1', weight: 100, reps: 5, volume: 500 }),
    ]);
    // The warm-up row keeps its own 1RM figure.
    expect(last?.sets[0].oneRepMax).toBeCloseTo(estimateOneRepMax(140, 3) as number, 8);
    expect(last).toMatchObject({ maxWeight: 100, volume: 500, knownVolume: 500, volumeComplete: true });
    expect(last?.oneRepMax).toBeCloseTo(estimateOneRepMax(100, 5) as number, 8);
  });

  it('skips a warm-up-only session: it is neither Last nor a record', () => {
    const { records, last } = deriveExerciseRecords([
      entry('s1', 1, [['100', '5', 'rir_1']]),
      entry('s2', 2, [['300', '5', 'warm_up']]),
    ]);

    expect(last?.completedAt).toEqual(new Date(Date.UTC(2026, 8, 1, 18)));
    expect(last?.sets.map((set) => set.weight)).toEqual([100]);
    expect(records.maxWeight?.weight).toBe(100);
    expect(records.volume?.value).toBe(500);
  });

  it('has no records and no Last when every session is warm-ups only', () => {
    expect(deriveExerciseRecords([entry('s1', 1, [['60', '10', 'warm_up']])])).toEqual({
      records: { oneRepMax: null, maxWeight: null, volume: null },
      last: null,
    });
  });
});
