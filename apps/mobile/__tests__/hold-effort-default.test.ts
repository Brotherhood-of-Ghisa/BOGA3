import { defaultSessionSetType } from '@/src/data/set-types';
import { isRecordingMode } from '@/src/exercise-core/recording-mode';
import { rebaseWorkoutEdit, sameWorkoutRow } from '@/src/exercise-core/workout-rebase';
import type { MergeWireEntity } from '@/src/exercise-core/merge-types';

describe('hold creation defaults', () => {
  it('uses RIR-0 only when the new hold supplies no effort', () => {
    expect(defaultSessionSetType(undefined, undefined, 'hold')).toBe('rir_0');
    expect(defaultSessionSetType(undefined, ['technique'], 'hold')).toBe('rir_0');
    for (const effort of [null, 'warm_up', 'rehab', 'rir_4', 'rir_12'] as const) {
      expect(defaultSessionSetType(effort, ['rir_0'], 'hold')).toBe(effort);
    }
  });

  it('retains the existing repetition defaults', () => {
    expect(defaultSessionSetType(undefined)).toBe('warm_up');
    expect(defaultSessionSetType('warm_up')).toBeNull();
    expect(defaultSessionSetType('rir_4')).toBe('rir_4');
  });

  it('accepts only explicit recording modes', () => {
    expect(isRecordingMode('reps')).toBe(true);
    expect(isRecordingMode('hold')).toBe(true);
    for (const value of [null, undefined, 'seconds', '', 45]) {
      expect(isRecordingMode(value)).toBe(false);
    }
  });
});

it('rebases duration-only set edits while ignoring derived session duration', () => {
  const row = (type: string, seconds: number): MergeWireEntity => ({
    type, id: 'row', client_updated_at_ms: 1, fields: { duration_sec: seconds },
  });
  expect(sameWorkoutRow(row('sessions', 45), row('sessions', 38))).toBe(true);
  expect(sameWorkoutRow(row('exercise_sets', 45), row('exercise_sets', 38))).toBe(false);
  const before = [row('exercise_sets', 45)];
  const edited = [row('exercise_sets', 38)];
  expect(rebaseWorkoutEdit(before, edited, before)).toMatchObject({
    changed: true, preserved: [], rows: [{ fields: { duration_sec: 38 } }],
  });
  expect(rebaseWorkoutEdit(before, edited, [row('exercise_sets', 40)])).toMatchObject({
    changed: false, preserved: edited,
  });
});
