/**
 * Device-side group metrics (groups contract): the session's performed-set
 * rule and parsers applied to the raw set rows the group reads return.
 */

import {
  computeGroupSessionMetrics,
  selectGroupPerformedExercises,
  toGroupPerformedSet,
  type GroupSessionExercise,
  type GroupSessionSet,
} from '@/src/groups';

const rawSet = (
  setId: string,
  weight: string,
  reps: string,
  overrides: Partial<GroupSessionSet> = {},
): GroupSessionSet => ({
  set_id: setId,
  order_index: 0,
  weight_value: weight,
  reps_value: reps,
  set_type: 'working',
  performance_status: null,
  ...overrides,
});

const exercise = (id: string, sets: GroupSessionSet[]): GroupSessionExercise => ({
  exercise_definition_id: `definition-${id}`,
  load_input_mode: 'total_load',
  session_exercise_id: id,
  name: `Exercise ${id}`,
  machine_name: null,
  order_index: 0,
  sets,
});

describe('group session metrics', () => {
  describe('performed sets', () => {
    it('parses a confirmed set, trimming whitespace', () => {
      expect(toGroupPerformedSet(rawSet('s1', ' 102.5 ', '5 ', { order_index: 3, set_type: 'rir_1' }))).toMatchObject({
        setId: 's1',
        orderIndex: 3,
        weightKg: 102.5,
        reps: 5,
        setType: 'rir_1',
      });
    });

    it('reads a blank weight with valid reps as 0 kg', () => {
      expect(toGroupPerformedSet(rawSet('s1', '', '8'))).toMatchObject({ weightKg: 0, reps: 8 });
    });

    it('excludes every explicit non-performed status, including future unknown statuses', () => {
      for (const status of ['planned', 'skipped', 'unperformed']) {
        expect(toGroupPerformedSet(rawSet('s1', '100', '5', { performance_status: status }))).toBeNull();
      }
      expect(toGroupPerformedSet(rawSet('s1', '100', '5', { performance_status: 'future_status' }))).toBeNull();
    });

    it('excludes values the set logger would not accept', () => {
      const rejected = [
        ['100', ''],
        ['100', '0'],
        ['100', '2.5'],
        ['1e3', '5'],
        ['-5', '5'],
        ['abc', '5'],
        ['', ''],
      ];
      for (const [weight, reps] of rejected) {
        expect(toGroupPerformedSet(rawSet('s1', weight, reps))).toBeNull();
      }
    });
  });

  describe('card metrics', () => {
    const exercises = [
      exercise('bench', [
        rawSet('b1', '102.5', '5'),
        rawSet('b2', '110', '5', { order_index: 1, performance_status: 'planned' }),
        rawSet('b3', '60', '10', { order_index: 2, set_type: 'warm_up' }),
      ]),
      exercise('row', [rawSet('r1', '80', '8')]),
      exercise('plan', [rawSet('p1', '50', '5', { performance_status: 'planned' })]),
      exercise('empty', []),
    ];

    it('counts and sums kg × reps of working sets, and counts exercises with a working set', () => {
      // 102.5 × 5 + 80 × 8; the 60 × 10 warm-up is neither a set nor volume.
      expect(computeGroupSessionMetrics(exercises)).toMatchObject({
        workingSets: 2,
        totalVolumeKg: 1152.5,
        exerciseCount: 2,
      });
    });

    it('adds no set, volume, coverage or exercise for a warm-up-only exercise', () => {
      const warmUpOnly = exercise('warm', [rawSet('w1', '60', '10', { set_type: 'warm_up' })]);
      const metrics = computeGroupSessionMetrics([warmUpOnly]);
      expect(metrics).toMatchObject({ workingSets: 0, totalVolumeKg: 0, exerciseCount: 0 });
      expect(metrics.coverage).toMatchObject({ eligibleSetCount: 0, complete: true });
      // Still shown in the friend's session view: it has a performed set.
      expect(selectGroupPerformedExercises([warmUpOnly]).map((selected) => selected.sessionExerciseId)).toEqual(['warm']);
      expect(computeGroupSessionMetrics([...exercises, warmUpOnly])).toMatchObject({ workingSets: 2, exerciseCount: 2 });
    });

    it('is all zeros before anything is performed', () => {
      expect(computeGroupSessionMetrics([])).toMatchObject({ workingSets: 0, totalVolumeKg: 0, exerciseCount: 0 });
      expect(computeGroupSessionMetrics([exercises[2], exercises[3]])).toMatchObject({
        workingSets: 0,
        totalVolumeKg: 0,
        exerciseCount: 0,
      });
    });

    it('keeps server order and omits exercises with no performed set', () => {
      expect(
        selectGroupPerformedExercises(exercises).map((selected) => [
          selected.sessionExerciseId,
          selected.sets.map((set) => set.setId),
        ]),
      ).toEqual([
        ['bench', ['b1', 'b3']],
        ['row', ['r1']],
      ]);
    });
  });
});

describe('shared-session presentation', () => {
  it('uses the same entered Weight and volume presentation as an ordinary exercise', () => {
    const row = exercise('pull-up', [rawSet('set', '10', '5')]);
    expect(computeGroupSessionMetrics([row])).toMatchObject({
      workingSets: 1,
      totalVolumeKg: 50,
      exerciseCount: 1,
    });
    expect(selectGroupPerformedExercises([row])[0].sets[0]).toMatchObject({
      enteredWeight: 10,
      weightKg: 10,
      metrics: { load: { calculatedLoadKg: 10 }, volumeKgReps: 50 },
    });
  });

  it('keeps the group exercise load mode while never requiring private bodyweight context', () => {
    const row = { ...exercise('press', [rawSet('set', '20', '5')]), load_input_mode: 'per_side_load' };
    expect(selectGroupPerformedExercises([row])[0].loadContext).toMatchObject({
      loadInputMode: 'per_side_load',
      bodyweightContribution: 0,
    });
    expect(computeGroupSessionMetrics([row])).toMatchObject({ totalVolumeKg: 100 });
  });
});
