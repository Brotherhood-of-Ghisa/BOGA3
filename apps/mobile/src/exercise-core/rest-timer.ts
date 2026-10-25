// The rest timer's one range, shared by the device-global default and an
// exercise's own default (docs/product/timer.md, timer.rest-default).
// Import-free so the agent API Edge Function applies the same boundary.

export const MIN_REST_TIMER_SECONDS = 15;
export const MAX_REST_TIMER_SECONDS = 600;

export const REST_TIMER_RANGE_MESSAGE =
  `Rest timer must be a whole number of seconds from ${MIN_REST_TIMER_SECONDS} to ${MAX_REST_TIMER_SECONDS}.`;

export const isRestTimerSec = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= MIN_REST_TIMER_SECONDS &&
  value <= MAX_REST_TIMER_SECONDS;

export type ExerciseRestTimerValidation =
  | { ok: true; value: number | null }
  | { ok: false; field: 'restTimerSec'; message: string };

/** An exercise's rest default: `null` (use the global timer) or an in-range value. */
export const validateExerciseRestTimerSec = (value: unknown): ExerciseRestTimerValidation =>
  value === null || isRestTimerSec(value)
    ? { ok: true, value }
    : { ok: false, field: 'restTimerSec', message: REST_TIMER_RANGE_MESSAGE };

/**
 * The rest a set on this exercise starts: the exercise's own default, else the
 * global one. A stored value out of range (a newer or buggy writer) is ignored
 * rather than trusted.
 */
export const resolveRestTimerSec = (exerciseRestTimerSec: number | null | undefined, globalRestTimerSec: number) =>
  isRestTimerSec(exerciseRestTimerSec) ? exerciseRestTimerSec : globalRestTimerSec;
