/**
 * Outcome: an agent can only write an exercise the app's own editor could
 * save — a trimmed non-empty name, a known load mode, a 0..1 bodyweight
 * contribution, exactly one primary muscle at weight 1 and distinct
 * secondaries at weight ½ — and an edit always quotes the revision it read.
 *
 * The Edge Function (`supabase/functions/agent-api`) applies these pure rules
 * before any database call; the backend `agent-api` lane proves the SQL side.
 */

import {
  ExerciseEditError,
  MAX_EXERCISE_MUSCLES,
  PRIMARY_MUSCLE_WEIGHT,
  SECONDARY_MUSCLE_WEIGHT,
  normalizeExerciseCreate,
  normalizeExerciseRevision,
  normalizeExerciseUpdate,
} from '../../../supabase/functions/agent-api/exercise-edit.ts';
import {
  PRIMARY_MUSCLE_WEIGHT as EDITOR_PRIMARY_WEIGHT,
  SECONDARY_MUSCLE_WEIGHT as EDITOR_SECONDARY_WEIGHT,
} from '@/src/exercise-catalog/editor-model';

const rejection = (read: () => unknown): string => {
  try {
    read();
  } catch (error) {
    if (error instanceof ExerciseEditError) return error.message;
    throw error;
  }
  throw new Error('expected an ExerciseEditError');
};

const primary = { muscle_id: 'chest_sternal', role: 'primary' };
const secondary = { muscle_id: 'triceps_long', role: 'secondary' };

const REST_REJECTION = 'rest_timer_sec must be null or a whole number of seconds from 15 to 600.';

describe('agent exercise create', () => {
  it('takes the app defaults for omitted optional fields', () => {
    expect(normalizeExerciseCreate({ name: '  Incline  Press ', muscles: [primary] })).toEqual({
      name: 'Incline  Press',
      load_input_mode: 'total_load',
      bodyweight_contribution: 0,
      split_by_gym: false,
      muscles: [{ muscle_id: 'chest_sternal', role: 'primary', weight: 1 }],
    });
  });

  it('keeps a rest timer in the app\'s range', () => {
    expect(normalizeExerciseCreate({ name: 'Row', rest_timer_sec: 15, muscles: [primary] }).rest_timer_sec).toBe(15);
    expect(normalizeExerciseCreate({ name: 'Row', rest_timer_sec: 600, muscles: [primary] }).rest_timer_sec).toBe(600);
    expect(normalizeExerciseCreate({ name: 'Row', rest_timer_sec: null, muscles: [primary] }).rest_timer_sec).toBeNull();
    // Unsent, the key stays out, so the idempotency hash of a create body is unchanged.
    expect(normalizeExerciseCreate({ name: 'Row', muscles: [primary] })).not.toHaveProperty('rest_timer_sec');
  });

  it('weights muscles as the editor does and lists the primary first', () => {
    const created = normalizeExerciseCreate({
      name: 'Dip',
      load_input_mode: 'total_load',
      bodyweight_contribution: 1,
      split_by_gym: true,
      muscles: [secondary, primary],
    });
    expect(created.muscles).toEqual([
      { muscle_id: 'chest_sternal', role: 'primary', weight: EDITOR_PRIMARY_WEIGHT },
      { muscle_id: 'triceps_long', role: 'secondary', weight: EDITOR_SECONDARY_WEIGHT },
    ]);
    expect([PRIMARY_MUSCLE_WEIGHT, SECONDARY_MUSCLE_WEIGHT]).toEqual([EDITOR_PRIMARY_WEIGHT, EDITOR_SECONDARY_WEIGHT]);
    expect(created.split_by_gym).toBe(true);
  });

  it.each([
    ['a blank name', { name: '   ', muscles: [primary] }, 'name must be 1 to 100 characters.'],
    ['a missing name', { muscles: [primary] }, 'name is required.'],
    ['an unknown load mode', { name: 'Row', load_input_mode: 'kg', muscles: [primary] }, 'load_input_mode must be one of: total_load, per_side_load.'],
    ['a contribution above 1', { name: 'Row', bodyweight_contribution: 1.5, muscles: [primary] }, 'bodyweight_contribution must be a number from 0 to 1.'],
    ['a non-boolean split', { name: 'Row', split_by_gym: 'yes', muscles: [primary] }, 'split_by_gym must be true or false.'],
    ['a rest timer below 15', { name: 'Row', rest_timer_sec: 14, muscles: [primary] }, REST_REJECTION],
    ['a rest timer above 600', { name: 'Row', rest_timer_sec: 601, muscles: [primary] }, REST_REJECTION],
    ['a fractional rest timer', { name: 'Row', rest_timer_sec: 90.5, muscles: [primary] }, REST_REJECTION],
    ['a text rest timer', { name: 'Row', rest_timer_sec: '90', muscles: [primary] }, REST_REJECTION],
    ['no muscles', { name: 'Row', muscles: [] }, `muscles must list 1 to ${MAX_EXERCISE_MUSCLES} muscles.`],
    ['no primary', { name: 'Row', muscles: [secondary] }, 'muscles must have exactly one primary muscle.'],
    ['two primaries', { name: 'Row', muscles: [primary, { muscle_id: 'lats', role: 'primary' }] }, 'muscles must have exactly one primary muscle.'],
    ['a repeated muscle', { name: 'Row', muscles: [primary, { muscle_id: 'chest_sternal', role: 'secondary' }] }, 'muscles lists chest_sternal twice.'],
    ['a stabilizer role', { name: 'Row', muscles: [primary, { muscle_id: 'abs', role: 'stabilizer' }] }, 'muscles[1].role must be primary or secondary.'],
    ['a weight the caller chose', { name: 'Row', muscles: [{ ...primary, weight: 0.8 }] }, 'Unsupported field: weight'],
    ['an unknown field', { name: 'Row', muscles: [primary], equipment: 'cable' }, 'Unsupported field: equipment'],
  ])('rejects %s', (_label, body, message) => {
    expect(rejection(() => normalizeExerciseCreate(body))).toBe(message);
  });

  it('rejects more muscles than the cap', () => {
    const muscles = [primary, ...Array.from({ length: MAX_EXERCISE_MUSCLES }, (_, index) => ({
      muscle_id: `muscle_${index}`,
      role: 'secondary',
    }))];
    expect(rejection(() => normalizeExerciseCreate({ name: 'Row', muscles }))).toBe(
      `muscles must list 1 to ${MAX_EXERCISE_MUSCLES} muscles.`,
    );
  });
});

describe('agent exercise update', () => {
  it('carries only the fields present, with the revision it read', () => {
    expect(normalizeExerciseUpdate({ expected_revision: 1_760_000_000_000, split_by_gym: true })).toEqual({
      expected_revision: 1_760_000_000_000,
      changes: { split_by_gym: true },
    });
  });

  it('clears the rest timer on an explicit null and leaves it alone when absent', () => {
    expect(normalizeExerciseUpdate({ expected_revision: 5, rest_timer_sec: null }).changes).toEqual({ rest_timer_sec: null });
    expect(normalizeExerciseUpdate({ expected_revision: 5, rest_timer_sec: 120 }).changes).toEqual({ rest_timer_sec: 120 });
    expect(normalizeExerciseUpdate({ expected_revision: 5, name: 'Row' }).changes).not.toHaveProperty('rest_timer_sec');
  });

  it('replaces the whole muscle set when muscles is present', () => {
    const update = normalizeExerciseUpdate({ expected_revision: 5, muscles: [primary, secondary], load_input_mode: 'per_side_load' });
    expect(update.changes.load_input_mode).toBe('per_side_load');
    expect(update.changes.muscles?.map((muscle) => muscle.muscle_id)).toEqual(['chest_sternal', 'triceps_long']);
  });

  it.each([
    ['no revision', { name: 'Row' }, 'expected_revision must be the revision the exercise was read with.'],
    ['a text revision', { expected_revision: '5', name: 'Row' }, 'expected_revision must be the revision the exercise was read with.'],
    ['nothing to change', { expected_revision: 5 }, 'Name at least one field to change.'],
    ['an invalid change', { expected_revision: 5, muscles: [secondary] }, 'muscles must have exactly one primary muscle.'],
    ['an unknown field', { expected_revision: 5, deleted: true }, 'Unsupported field: deleted'],
  ])('rejects %s', (_label, body, message) => {
    expect(rejection(() => normalizeExerciseUpdate(body))).toBe(message);
  });
});

describe('agent exercise delete and restore', () => {
  it('reads only the revision', () => {
    expect(normalizeExerciseRevision({ expected_revision: 42 })).toBe(42);
    expect(rejection(() => normalizeExerciseRevision({}))).toBe(
      'expected_revision must be the revision the exercise was read with.',
    );
    expect(rejection(() => normalizeExerciseRevision({ expected_revision: 42, name: 'x' }))).toBe('Unsupported field: name');
  });
});
