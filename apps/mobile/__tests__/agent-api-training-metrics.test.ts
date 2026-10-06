import {
  METRIC_REVISION, projectTrainingSets, type EnteredSetRow, type SessionWeightRow,
} from '../../../supabase/functions/agent-api/training-metrics.ts';
import { GROUP_COACHING_ELIGIBILITY } from './helpers/set-eligibility';

const noReading: SessionWeightRow = {
  body_weight_kg: null, body_weight_source: null, body_weight_measurement_id: null, body_weight_measured_at: null,
};
const ordinary = { bodyweight_contribution: 0, load_input_mode: 'total_load' };

const set = (id: string, weight: string, reps: string, setType: string | null,
  status: string | null = null): EnteredSetRow => ({
  id, order_index: Number(id.replace(/\D/g, '')), weight_value: weight, reps_value: reps,
  set_type: setType, performance_status: status,
});

describe('agent-api training projection', () => {
  it('labels the working-set meaning of its figures', () => {
    expect(METRIC_REVISION).toBe('working_sets_v4');
  });

  it.each(GROUP_COACHING_ELIGIBILITY)("applies set.eligibility's fixed coaching rule to %s", (_label, setType, counts) => {
    const projection = projectTrainingSets([set('s0', '100', '5', setType)], ordinary, noReading, false);

    expect(projection.workingSetCount).toBe(counts ? 1 : 0);
    expect(projection.volumeCoverage).toMatchObject({ totalVolumeKgReps: counts ? 500 : 0, eligibleSetCount: counts ? 1 : 0 });
    expect(projection.topWeightSet).toEqual(counts ? { weight: 100, reps: 5 } : null);
    expect(projection.estimatedOneRepMax === null).toBe(!counts);
    // Every performed row is listed with its own figures either way.
    expect(projection.sets).toEqual([expect.objectContaining({ id: 's0', set_type: setType, volume: { value: 500, unit: 'kg_reps' } })]);
  });

  it('lists a heavier warm-up with its own figures but excludes it from every aggregate', () => {
    const projection = projectTrainingSets([
      set('s0', '140', '5', 'warm_up'),
      set('s1', '100', '8', 'rir_1'),
      set('s2', '105', '5', null),
      set('s3', '200', '10', 'rir_0', 'unperformed'),
    ], ordinary, noReading, false);

    expect(projection.workingSetCount).toBe(2);
    expect(projection.workingMetrics.map(metric => metric.volumeKgReps)).toEqual([800, 525]);
    expect(projection.volumeCoverage).toMatchObject({
      totalVolumeKgReps: 1325, eligibleSetCount: 2, knownSetCount: 2, complete: true,
    });
    expect(projection.topWeightSet).toEqual({ weight: 105, reps: 5 });
    expect(projection.estimatedOneRepMax).toBeLessThan(140);

    expect(projection.sets.map(row => [row.id, row.set_type])).toEqual([
      ['s0', 'warm_up'], ['s1', 'rir_1'], ['s2', null],
    ]);
    expect(projection.sets[0]).toMatchObject({
      load: { value: 140, unit: 'kg' }, volume: { value: 700, unit: 'kg_reps' },
    });
    expect(projection.sets[0].estimated_one_rep_max!.value).toBeGreaterThan(projection.estimatedOneRepMax!);
  });

  it('gives a warm-up-only block no stat footprint while keeping its rows', () => {
    const projection = projectTrainingSets([
      set('s0', '60', '10', 'warm_up'),
      set('s1', '80', '5', 'warm_up'),
    ], ordinary, noReading, false);

    expect(projection.workingSetCount).toBe(0);
    expect(projection.estimatedOneRepMax).toBeNull();
    expect(projection.topWeightSet).toBeNull();
    expect(projection.volumeCoverage).toMatchObject({ totalVolumeKgReps: 0, eligibleSetCount: 0 });
    expect(projection.sets.map(row => row.id)).toEqual(['s0', 's1']);
  });

  it('counts untagged and unrecognised set types as working sets', () => {
    const projection = projectTrainingSets([
      set('s0', '50', '5', 'working'),
      set('s1', '50', '5', null),
      set('s2', '', '', 'rir_2'),
    ], ordinary, noReading, false);

    expect(projection.workingSetCount).toBe(2);
    expect(projection.volumeCoverage.totalVolumeKgReps).toBe(500);
    expect(projection.sets.map(row => row.id)).toEqual(['s0', 's1']);
  });

  it('applies the bodyweight context to working-set aggregates and warm-up rows alike', () => {
    const reading: SessionWeightRow = {
      body_weight_kg: 80, body_weight_source: 'reading', body_weight_measurement_id: 'r', body_weight_measured_at: 0,
    };
    const projection = projectTrainingSets([
      set('s0', '40', '5', 'warm_up'),
      set('s1', '20', '8', 'rir_1'),
    ], { bodyweight_contribution: 1, load_input_mode: 'total_load' }, reading, true);

    expect(projection.usesBodyweightContext).toBe(true);
    expect(projection.volumeCoverage.totalVolumeKgReps).toBe(800);
    expect(projection.topWeightSet).toEqual({ weight: 20, reps: 8 });
    expect(projection.sets[0].calculated_load.value).toBe(120);
    expect(projection.sets[0].volume.value).toBe(600);
  });
});
