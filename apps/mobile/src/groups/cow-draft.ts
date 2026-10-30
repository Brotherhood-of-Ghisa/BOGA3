import type { CompetitionExerciseWire } from './competition-wire';
import type { CoWMetric } from './cow-scoring';
import type { CoWDefinitionWire } from './cow-wire';
export type CoWDraft = { exerciseId: string | null; metrics: CoWMetric[]; revision: number | null };
export const emptyCoWDraft: CoWDraft = { exerciseId: null, metrics: [], revision: null };
export const coWDraftFrom = (cow: CoWDefinitionWire): CoWDraft => ({ exerciseId: cow.group_exercise_id, metrics: cow.metrics, revision: cow.revision });

/** Non-secret idempotency identity; group authorization is always server-owned. */
export const createCoWId = (): string => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, symbol => {
  const value = Math.floor(Math.random() * 16);
  return (symbol === 'x' ? value : (value & 3) | 8).toString(16);
});
export function validateCoWDraft(draft: CoWDraft, exercises: CompetitionExerciseWire[] | null) {
  return { exercise: !draft.exerciseId ? 'Choose an exercise.' : exercises === null ? 'Refresh group exercises.'
    : !exercises.some(row => row.group_exercise_id === draft.exerciseId && row.archived_at_ms === null) ? 'Choose an available group exercise.' : null,
  metrics: draft.metrics.length === 0 ? 'Choose at least one leaderboard.' : null };
}
