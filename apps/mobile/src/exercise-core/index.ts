// The exercise fields a personal exercise (`exercise_definitions`) and a group
// exercise (`app_public.group_exercises`) share, and their one validator
// (M25 design T1: one domain type, two stores). The personal repository and the
// group RPC client both validate through `validateExerciseCore`; the server
// applies the same rules in SQL (`group_exercise_trim` and the
// `group_exercises` CHECKs). `exercise-core-vectors.json` holds the two sides
// in parity: jest runs it against this file, `groups-contract` against the RPCs
// and CHECKs.
//
// No imports, so a Deno Edge Function can load this file by relative path.

export const LOAD_INPUT_MODES = ['total_load', 'per_side_load'] as const;

export type LoadInputMode = (typeof LOAD_INPUT_MODES)[number];

export type ExerciseCore = {
  name: string;
  loadInputMode: LoadInputMode;
};

export const isLoadInputMode = (value: unknown): value is LoadInputMode =>
  typeof value === 'string' && (LOAD_INPUT_MODES as readonly string[]).includes(value);

export type ExerciseCoreIssue = 'name_required' | 'load_input_mode_invalid';

export const EXERCISE_CORE_ISSUE_MESSAGES: Record<ExerciseCoreIssue, string> = {
  name_required: 'Exercise name is required',
  load_input_mode_invalid: 'Weight entry must be total load or per side',
};

export type ExerciseCoreValidation =
  | { ok: true; value: ExerciseCore }
  | { ok: false; issue: ExerciseCoreIssue; message: string };

const invalid = (issue: ExerciseCoreIssue): ExerciseCoreValidation => ({
  ok: false,
  issue,
  message: EXERCISE_CORE_ISSUE_MESSAGES[issue],
});

/**
 * Normalizes and validates the shared fields. The name is `String#trim`med and
 * must be non-empty; inner whitespace and case are kept. The load mode must be
 * one of `LOAD_INPUT_MODES` exactly. The name is checked first.
 */
export const validateExerciseCore = (input: { name: unknown; loadInputMode: unknown }): ExerciseCoreValidation => {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length === 0) {
    return invalid('name_required');
  }
  if (!isLoadInputMode(input.loadInputMode)) {
    return invalid('load_input_mode_invalid');
  }
  return { ok: true, value: { name, loadInputMode: input.loadInputMode } };
};
