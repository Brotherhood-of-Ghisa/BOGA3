/**
 * Device-side group metrics (groups contract §5): the session's performed-set
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
  session_exercise_id: id,
  name: `Exercise ${id}`,
  machine_name: null,
  order_index: 0,
  sets,
});

describe('group session metrics', () => {
  describe('performed sets', () => {
    it('parses a confirmed set, trimming whitespace', () => {
      expect(toGroupPerformedSet(rawSet('s1', ' 102.5 ', '5 ', { order_index: 3, set_type: 'rir_1' }))).toEqual({
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

    it('excludes planned, skipped, and unperformed sets; an unknown status normalizes to performed', () => {
      for (const status of ['planned', 'skipped', 'unperformed']) {
        expect(toGroupPerformedSet(rawSet('s1', '100', '5', { performance_status: status }))).toBeNull();
      }
      expect(toGroupPerformedSet(rawSet('s1', '100', '5', { performance_status: 'future_status' }))).not.toBeNull();
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

    it('counts performed sets, sums kg × reps with warm-ups, and counts exercises with a performed set', () => {
      expect(computeGroupSessionMetrics(exercises)).toEqual({
        performedSets: 3,
        totalVolumeKg: 1752.5,
        exerciseCount: 2,
      });
    });

    it('is all zeros before anything is performed', () => {
      expect(computeGroupSessionMetrics([])).toEqual({ performedSets: 0, totalVolumeKg: 0, exerciseCount: 0 });
      expect(computeGroupSessionMetrics([exercises[2], exercises[3]])).toEqual({
        performedSets: 0,
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
