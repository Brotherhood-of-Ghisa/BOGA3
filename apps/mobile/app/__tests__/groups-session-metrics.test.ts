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

    it('counts performed sets, sums kg × reps with warm-ups, and counts exercises with a performed set', () => {
      expect(computeGroupSessionMetrics(exercises)).toMatchObject({
        performedSets: 3,
        totalVolumeKg: 1752.5,
        exerciseCount: 2,
      });
    });

    it('is all zeros before anything is performed', () => {
      expect(computeGroupSessionMetrics([])).toMatchObject({ performedSets: 0, totalVolumeKg: 0, exerciseCount: 0 });
      expect(computeGroupSessionMetrics([exercises[2], exercises[3]])).toMatchObject({
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


describe('shared-session personal effective-load context', () => {
  const session = { metric_scope: 'personal' as const, metric_revision: 'dated_added_load_v3' as const,
    body_weight_kg: 80, body_weight_source: 'reading', body_weight_measurement_id: 'r',
    body_weight_measured_at_ms: 1000 };
  const bwExercise = (overrides: Partial<GroupSessionExercise> = {}) => ({
    ...exercise('pull', [rawSet('set', '10', '5', { weight_unit: 'kg', external_load_mode: 'added' })]),
    bodyweight_coefficient: 0.5, load_input_mode: 'per_side_load', ...overrides,
  });
  it('uses the personal coefficient and frozen B, counting bodyweight only once', () => {
    const result = computeGroupSessionMetrics([bwExercise()], session);
    expect(result).toMatchObject({ basis: 'personal', performedSets: 1, totalVolumeKg: 300,
      coverage: { complete: true, knownSetCount: 1 } });
    expect(selectGroupPerformedExercises([bwExercise()], session)[0].sets[0])
      .toMatchObject({ enteredWeight: 10, weightKg: 10, metrics: { load: { resistanceKg: 60 } } });
  });
  it('uses the numeric added weight despite obsolete mode tags', () => {
    const row = bwExercise({ sets: [rawSet('assist', '10', '5', { weight_unit: 'kg', external_load_mode: 'assistance' })] });
    expect(computeGroupSessionMetrics([row], session)).toMatchObject({ performedSets: 1, totalVolumeKg: 300 });
  });
  it('normalizes lb, while keeping raw amount and unit for the visible row', () => {
    const row = bwExercise({ load_input_mode: 'total_load',
      sets: [rawSet('lb', '20', '5', { weight_unit: 'lb', external_load_mode: 'added' })] });
    expect(computeGroupSessionMetrics([row], session).totalVolumeKg).toBeCloseTo((40 + 20 * 0.45359237) * 5);
    expect(selectGroupPerformedExercises([row], session)[0].sets[0]).toMatchObject({ enteredWeight: 20, weightUnit: 'lb' });
  });
  it('keeps a conventional subtotal explicit when bodyweight context is missing', () => {
    const conventional = bwExercise({ bodyweight_coefficient: 0 });
    const result = computeGroupSessionMetrics([conventional, bwExercise()], {
      ...session, body_weight_kg: null, body_weight_source: null, body_weight_measurement_id: null, body_weight_measured_at_ms: null });
    expect(result).toMatchObject({ performedSets: 2, totalVolumeKg: null,
      coverage: { complete: false, knownVolumeKgReps: 50, knownSetCount: 1, missingSetCount: 1 } });
  });
  it('rejects a positive B with malformed provenance instead of calculating strength', () => {
    const result = computeGroupSessionMetrics([bwExercise()], { ...session, body_weight_source: null });
    expect(result).toMatchObject({ performedSets: 1, totalVolumeKg: null,
      coverage: { knownSetCount: 0, invalidSetCount: 1 } });
  });
  it('rejects obsolete historical-estimate context in live shared calculations', () => {
    expect(computeGroupSessionMetrics([bwExercise()], { ...session, body_weight_source: 'historical_estimate',
      body_weight_measurement_id: 'old-reading', body_weight_measured_at_ms: 1000 }).totalVolumeKg).toBeNull();
  });
  it.each([
    { bodyweight_coefficient: null }, { load_input_mode: null },
    { sets: [rawSet('unit', '10', '5', { external_load_mode: 'added' })] },
  ])('does not guess absent or unresolved metadata: %j', overrides => {
    expect(computeGroupSessionMetrics([bwExercise(overrides)], session)).toMatchObject({
      performedSets: 1, totalVolumeKg: null, coverage: { complete: false } });
  });
  it('labels old payloads with their original entered-load basis', () => {
    expect(computeGroupSessionMetrics([exercise('legacy', [rawSet('old', '10', '5')])]))
      .toMatchObject({ basis: 'legacy_entered_load', totalVolumeKg: 50 });
  });
});
