/** Workout writes record explicit performance; never turn plan targets or ambiguous units into actuals. */
import { normalizeWorkoutInput, WorkoutInputError } from '../../../supabase/functions/agent-api/workout-input';

const revision = 'a'.repeat(32);
const base = { session_id: 'workout', expected_revision: revision };
const set = { weight_kg: '80', reps: 8 };

it('normalizes strict operations into stable retry payloads', () => {
  expect(normalizeWorkoutInput('start_workout', {})).toEqual({ gym_id: null });
  expect(normalizeWorkoutInput('start_workout', { gym_id: 'gym' })).toEqual({ gym_id: 'gym' });
  expect(normalizeWorkoutInput('log_sets', { ...base, exercise_id: 'bench', sets: [set, { weight_kg: ' 0.0 ', reps: 999, set_type: 'warm_up' }] }))
    .toEqual({ ...base, exercise_id: 'bench', sets: [{ ...set, set_type: null }, { weight_kg: '0.0', reps: 999, set_type: 'warm_up' }] });
  expect(normalizeWorkoutInput('log_sets', { ...base, session_exercise_id: 'block', sets: [set] })).toHaveProperty('session_exercise_id', 'block');
  expect(normalizeWorkoutInput('update_set', { ...base, set_id: 'set', set })).toEqual({ ...base, set_id: 'set', set: { ...set, set_type: null } });
  expect(normalizeWorkoutInput('delete_set', { ...base, set_id: 'set' })).toEqual({ ...base, set_id: 'set' });
  expect(normalizeWorkoutInput('finish_workout', base)).toEqual(base);
});

it.each([
  null, [], { ...base, sets: [set] }, { ...base, exercise_id: 'x', session_exercise_id: 'y', sets: [set] },
  { ...base, exercise_id: 'x', sets: [] }, { ...base, exercise_id: 'x', sets: Array(31).fill(set) },
  { ...base, exercise_id: '', sets: [set] }, { ...base, expected_revision: 1, exercise_id: 'x', sets: [set] },
  { ...base, owner_user_id: 'spoof', exercise_id: 'x', sets: [set] },
])('rejects ambiguous, unbounded and caller-owned identity input: %p', input => {
  expect(() => normalizeWorkoutInput('log_sets', input)).toThrow(WorkoutInputError);
});

it.each([
  { weight_kg: 80, reps: 8 }, { weight_kg: '', reps: 8 }, { weight_kg: '1e3', reps: 8 },
  { weight_kg: '-1', reps: 8 }, { weight_kg: 'NaN', reps: 8 }, { weight_kg: '9'.repeat(101), reps: 8 },
  { weight_kg: '80', reps: '8' }, { weight_kg: '80', reps: 0 }, { weight_kg: '80', reps: 1000 },
  { weight_kg: '80', reps: 1.5 }, { ...set, set_type: 'rir_5' }, { ...set, performance_status: 'planned' },
  { ...set, planned_reps: 8 }, { ...set, unit: 'lb' },
])('rejects values that cannot be explicit performed input: %p', input => {
  expect(() => normalizeWorkoutInput('update_set', { ...base, set_id: 'set', set: input })).toThrow(WorkoutInputError);
});

it('rejects missing identifiers, unknown fields and historical timestamps', () => {
  expect(() => normalizeWorkoutInput('delete_set', base)).toThrow(WorkoutInputError);
  expect(() => normalizeWorkoutInput('finish_workout', { ...base, completed_at: 1 })).toThrow(WorkoutInputError);
  expect(() => normalizeWorkoutInput('start_workout', { started_at: 1 })).toThrow(WorkoutInputError);
});
