import {
  listSessionExerciseLiveSets,
  reorderSessionExerciseSetOrder,
} from '@/src/data/session-drafts';
import { isExactIdPermutation } from './plan-validation';
import type { ReorderSessionSetsResult } from './types';

/**
 * General recorder operation (`reorderSessionExerciseSets`): rewrites one
 * card's performed set order from an exact permutation of its live set ids.
 * Pure validation happens here; the two-phase transactional rewrite lives in
 * `src/data` with the rest of the performed-graph writers.
 *
 * Only `exercise_sets.order_index` changes — row identity, `source_plan_set_id`,
 * planned and actual values, and confirmation/performance state are untouched,
 * and the source plan's immutable target order is never involved. Works for
 * the active recorder and the completed-session edit flow alike, for sourced
 * and unsourced cards, and survives autosave/hydration because the graph
 * round-trip reads rows back in stored order.
 */
export const reorderSessionExerciseSets = async (
  sessionExerciseId: string,
  orderedSetIds: string[],
  now: Date = new Date(),
): Promise<ReorderSessionSetsResult> => {
  const liveSets = await listSessionExerciseLiveSets(sessionExerciseId);
  if (!liveSets) {
    return { status: 'exercise-not-found' };
  }
  if (!isExactIdPermutation(liveSets, orderedSetIds)) {
    return { status: 'invalid-list' };
  }
  const wrote = await reorderSessionExerciseSetOrder(sessionExerciseId, orderedSetIds, now);
  return wrote ? { status: 'reordered' } : { status: 'invalid-list' };
};
