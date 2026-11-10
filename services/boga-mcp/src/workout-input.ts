/** Wire-input checks only; the agent API remains authoritative for performance and permission. */
export const isWorkoutWeight = (value: string): boolean =>
  value.length <= 100 && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) && Number.isFinite(Number(value));

export const isWorkoutOperationKey = (value: string): boolean => /^[\x21-\x7e]{1,128}$/.test(value);

export const hasOneWorkoutExerciseReference = (input: { exercise_id?: string; session_exercise_id?: string }): boolean =>
  (input.exercise_id === undefined) !== (input.session_exercise_id === undefined);
