import { MAX_SET_REPS, parseSetWeight } from '../../../apps/mobile/src/exercise-calculations/parse.ts';
import { SESSION_SET_TYPES } from '../../../apps/mobile/src/data/set-types.ts';

type ObjectValue = Record<string, unknown>;
export type WorkoutOperation = 'start_workout' | 'log_sets' | 'update_set' | 'delete_set' | 'finish_workout';

export class WorkoutInputError extends Error {}

function object(value: unknown, allowed: readonly string[]): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkoutInputError('Expected an object.');
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new WorkoutInputError(`Unsupported field: ${key}`);
  }
  return value as ObjectValue;
}

function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new WorkoutInputError(`${label} is required.`);
  return value;
}

function performedSet(value: unknown): ObjectValue {
  const input = object(value, ['weight_kg', 'reps', 'set_type']);
  // Use entered decimal text: exponent notation is not an app Weight input.
  if (typeof input.weight_kg !== 'string' || input.weight_kg.length > 100 || parseSetWeight(input.weight_kg) === null) {
    throw new WorkoutInputError('weight_kg must be a non-negative decimal string in kg (use "0" for no load).');
  }
  if (!Number.isInteger(input.reps) || Number(input.reps) < 1 || Number(input.reps) > MAX_SET_REPS) {
    throw new WorkoutInputError(`reps must be a whole number from 1 to ${MAX_SET_REPS}.`);
  }
  if (input.set_type !== undefined && input.set_type !== null &&
      !(SESSION_SET_TYPES as readonly unknown[]).includes(input.set_type)) {
    throw new WorkoutInputError('set_type must be null, warm_up, technique, cooldown or rir_0 through rir_4.');
  }
  return { weight_kg: input.weight_kg.trim(), reps: input.reps, set_type: input.set_type ?? null };
}

/** Strict normalized input also gives retries a stable hash independent of JSON key order. */
export function normalizeWorkoutInput(operation: WorkoutOperation, value: unknown): ObjectValue {
  if (operation === 'start_workout') {
    const body = object(value, ['gym_id']);
    return { gym_id: body.gym_id === null || body.gym_id === undefined ? null : id(body.gym_id, 'gym_id') };
  }
  const fields = ['session_id', 'expected_revision'];
  if (operation === 'log_sets') fields.push('exercise_id', 'session_exercise_id', 'sets');
  if (operation === 'update_set') fields.push('set_id', 'set');
  if (operation === 'delete_set') fields.push('set_id');
  const body = object(value, fields);
  const sessionId = id(body.session_id, 'session_id');
  if (typeof body.expected_revision !== 'string' || !/^[a-f0-9]{32}$/.test(body.expected_revision)) {
    throw new WorkoutInputError('expected_revision must be the revision returned by the latest workout read or write.');
  }
  const result: ObjectValue = { session_id: sessionId, expected_revision: body.expected_revision };
  if (operation === 'log_sets') {
    if ((body.exercise_id === undefined) === (body.session_exercise_id === undefined)) {
      throw new WorkoutInputError('Supply exactly one of exercise_id and session_exercise_id.');
    }
    if (!Array.isArray(body.sets) || body.sets.length < 1 || body.sets.length > 30) {
      throw new WorkoutInputError('sets must contain 1 to 30 performed sets.');
    }
    result[body.exercise_id === undefined ? 'session_exercise_id' : 'exercise_id'] =
      id(body.exercise_id ?? body.session_exercise_id, 'exercise reference');
    result.sets = body.sets.map(performedSet);
  }
  if (operation === 'update_set' || operation === 'delete_set') result.set_id = id(body.set_id, 'set_id');
  if (operation === 'update_set') result.set = performedSet(body.set);
  return result;
}
