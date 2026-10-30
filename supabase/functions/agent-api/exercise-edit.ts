// Wire validation for agent exercise writes. No database access and no HTTP,
// so Jest covers these rules beside the app's own exercise editor rules
// (`apps/mobile/src/exercise-catalog/editor-model.ts`), which they mirror:
// a trimmed non-empty name, a known load mode, a 0..1 bodyweight contribution,
// a rest timer of null (the global timer) or 15..600 whole seconds,
// one or more distinct primary muscles (weight 1) plus distinct secondaries (weight ½).
//
// The SQL writers (`agent_*_exercise` in
// supabase/migrations/20261019120000_agent_exercise_edit.sql) trust this shape
// and re-check only what needs the database: owner rows and revisions.

import { validateBodyweightContribution } from '../../../apps/mobile/src/exercise-core/bodyweight-contribution.ts';
import { isLoadInputMode, LOAD_INPUT_MODES } from '../../../apps/mobile/src/exercise-core/index.ts';
import {
  MAX_REST_TIMER_SECONDS,
  MIN_REST_TIMER_SECONDS,
  validateExerciseRestTimerSec,
} from '../../../apps/mobile/src/exercise-core/rest-timer.ts';

export const MAX_EXERCISE_NAME_LENGTH = 100;
export const MAX_EXERCISE_MUSCLES = 12;
export const PRIMARY_MUSCLE_WEIGHT = 1;
export const SECONDARY_MUSCLE_WEIGHT = 0.5;
const MAX_ID_LENGTH = 200;

type JsonObject = Record<string, unknown>;

export type ExerciseMuscleInput = {
  muscle_id: string;
  role: 'primary' | 'secondary';
  weight: number;
};

export type ExerciseCreate = {
  name: string;
  load_input_mode: string;
  bodyweight_contribution: number;
  split_by_gym: boolean;
  /** Null uses the device's global rest timer; omitted on create, it stores null. */
  rest_timer_sec?: number | null;
  muscles: ExerciseMuscleInput[];
};

export type ExerciseChanges = Partial<ExerciseCreate>;

export type ExerciseUpdate = {
  expected_revision: number;
  changes: ExerciseChanges;
};

/** A rejected exercise write; the Edge Function answers it as 400 INVALID_ARGUMENT. */
export class ExerciseEditError extends Error {}

const CREATE_KEYS = new Set(['name', 'load_input_mode', 'bodyweight_contribution', 'split_by_gym', 'rest_timer_sec', 'muscles']);
const UPDATE_KEYS = new Set([...CREATE_KEYS, 'expected_revision']);
const REVISION_KEYS = new Set(['expected_revision']);

const fail = (message: string): never => {
  throw new ExerciseEditError(message);
};

const rejectUnknownKeys = (body: JsonObject, allowed: ReadonlySet<string>): void => {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) fail(`Unsupported field: ${key}`);
  }
};

const readName = (value: unknown): string => {
  if (typeof value !== 'string') return fail('name is required.');
  // Trimmed only, as the app's ExerciseCore validator: inner spacing is kept.
  const name = value.trim();
  if (name.length < 1 || name.length > MAX_EXERCISE_NAME_LENGTH) {
    fail(`name must be 1 to ${MAX_EXERCISE_NAME_LENGTH} characters.`);
  }
  return name;
};

const readLoadInputMode = (value: unknown): string => {
  if (!isLoadInputMode(value)) fail(`load_input_mode must be one of: ${LOAD_INPUT_MODES.join(', ')}.`);
  return value as string;
};

const readContribution = (value: unknown): number => {
  const checked = validateBodyweightContribution(value);
  if (!checked.ok) return fail('bodyweight_contribution must be a number from 0 to 1.');
  return checked.value;
};

const readSplitByGym = (value: unknown): boolean => {
  if (typeof value !== 'boolean') fail('split_by_gym must be true or false.');
  return value as boolean;
};

const readRestTimerSec = (value: unknown): number | null => {
  const checked = validateExerciseRestTimerSec(value);
  if (!checked.ok) {
    return fail(`rest_timer_sec must be null or a whole number of seconds from ${MIN_REST_TIMER_SECONDS} to ${MAX_REST_TIMER_SECONDS}.`);
  }
  return checked.value;
};

const readMuscle = (value: unknown, index: number): ExerciseMuscleInput => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(`muscles[${index}] must be an object.`);
  }
  const entry = value as JsonObject;
  rejectUnknownKeys(entry, new Set(['muscle_id', 'role']));
  const muscleId = typeof entry.muscle_id === 'string' ? entry.muscle_id.trim() : '';
  if (muscleId.length < 1 || muscleId.length > MAX_ID_LENGTH) fail(`muscles[${index}].muscle_id is required.`);
  if (entry.role !== 'primary' && entry.role !== 'secondary') {
    fail(`muscles[${index}].role must be primary or secondary.`);
  }
  const role = entry.role as 'primary' | 'secondary';
  return {
    muscle_id: muscleId,
    role,
    weight: role === 'primary' ? PRIMARY_MUSCLE_WEIGHT : SECONDARY_MUSCLE_WEIGHT,
  };
};

const readMuscles = (value: unknown): ExerciseMuscleInput[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EXERCISE_MUSCLES) {
    return fail(`muscles must list 1 to ${MAX_EXERCISE_MUSCLES} muscles.`);
  }
  const muscles = value.map(readMuscle);
  const seen = new Set<string>();
  for (const muscle of muscles) {
    if (seen.has(muscle.muscle_id)) fail(`muscles lists ${muscle.muscle_id} twice.`);
    seen.add(muscle.muscle_id);
  }
  // Primaries first, then secondaries in the caller's order, so equal input
  // normalizes (and hashes for idempotency) the same.
  const primaries = muscles.filter((muscle) => muscle.role === 'primary');
  if (primaries.length === 0) fail('muscles must have at least one primary muscle.');
  return [...primaries, ...muscles.filter((muscle) => muscle.role === 'secondary')];
};

const readRevision = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail('expected_revision must be the revision the exercise was read with.');
  }
  return value;
};

/** A new exercise. Omitted optional fields take the app's defaults. */
export const normalizeExerciseCreate = (body: JsonObject): ExerciseCreate => {
  rejectUnknownKeys(body, CREATE_KEYS);
  return {
    name: readName(body.name),
    load_input_mode: body.load_input_mode === undefined ? 'total_load' : readLoadInputMode(body.load_input_mode),
    bodyweight_contribution: body.bodyweight_contribution === undefined ? 0 : readContribution(body.bodyweight_contribution),
    split_by_gym: body.split_by_gym === undefined ? false : readSplitByGym(body.split_by_gym),
    // Omitted when not sent, so a create body hashes (for idempotency) as it
    // did before the field existed.
    ...(body.rest_timer_sec === undefined ? {} : { rest_timer_sec: readRestTimerSec(body.rest_timer_sec) }),
    muscles: readMuscles(body.muscles),
  };
};

/** A partial edit: only the fields present change; `muscles` replaces the whole set. */
export const normalizeExerciseUpdate = (body: JsonObject): ExerciseUpdate => {
  rejectUnknownKeys(body, UPDATE_KEYS);
  const expected_revision = readRevision(body.expected_revision);
  const changes: ExerciseChanges = {};
  if (body.name !== undefined) changes.name = readName(body.name);
  if (body.load_input_mode !== undefined) changes.load_input_mode = readLoadInputMode(body.load_input_mode);
  if (body.bodyweight_contribution !== undefined) {
    changes.bodyweight_contribution = readContribution(body.bodyweight_contribution);
  }
  if (body.split_by_gym !== undefined) changes.split_by_gym = readSplitByGym(body.split_by_gym);
  // An explicit null clears the exercise's own timer back to the global one.
  if (body.rest_timer_sec !== undefined) changes.rest_timer_sec = readRestTimerSec(body.rest_timer_sec);
  if (body.muscles !== undefined) changes.muscles = readMuscles(body.muscles);
  if (Object.keys(changes).length === 0) fail('Name at least one field to change.');
  return { expected_revision, changes };
};

/** Delete and restore carry only the revision the exercise was read with. */
export const normalizeExerciseRevision = (body: JsonObject): number => {
  rejectUnknownKeys(body, REVISION_KEYS);
  return readRevision(body.expected_revision);
};
