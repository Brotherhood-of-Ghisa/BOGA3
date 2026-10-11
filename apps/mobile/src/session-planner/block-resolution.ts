import { isConfirmedPerformedSet } from '@/src/exercise-calculations/set-semantics';
import {
  createDrizzleSessionPlanStore,
  type SessionPlanStore,
} from '@/src/data/session-plan-store';
import type { ResolvePlanBlockResult } from './types';

/**
 * Explicit block resolution (`completePlanBlock` / `skipPlanBlock`): the only
 * operations that resolve a block and advance derived programme progress.
 * Attachment alone leaves a block pending.
 *
 * - **Complete** requires at least one valid confirmed performed set on the
 *   live sourced card whose `source_plan_set_id` belongs to this block.
 *   Manual warm-ups do not count, and target deviations never prevent
 *   completion — the performed values may differ from the authored targets.
 * - **Skip** is valid only while the block has no confirmed source-derived
 *   performed work, and never creates performed rows.
 *
 * Neither operation touches the performed graph; they write the block's
 * `progress_status` and `resolved_at` in one transaction.
 */

const planStore: SessionPlanStore = createDrizzleSessionPlanStore();

const confirmedSourceDerivedSets = async (
  planExerciseId: string,
  blockSetIds: Set<string>,
): Promise<boolean> => {
  const card = await planStore.findSourcedCardPerformances(planExerciseId);
  if (!card) {
    return false;
  }
  return card.sets.some(
    (set) =>
      set.sourcePlanSetId !== null &&
      blockSetIds.has(set.sourcePlanSetId) &&
      isConfirmedPerformedSet({
        reps: set.repsValue,
        weight: set.weightValue,
        performanceStatus: (set.performanceStatus as never) ?? null,
      }),
  );
};

export const completePlanBlock = async (
  planExerciseId: string,
  now: Date = new Date(),
): Promise<ResolvePlanBlockResult> => {
  const block = await planStore.loadPlanBlock(planExerciseId);
  if (!block) {
    return { status: 'block-not-found' };
  }
  if (block.exercise.progressStatus !== 'pending') {
    return { status: 'not-resolvable' };
  }
  const hasConfirmedWork = await confirmedSourceDerivedSets(
    planExerciseId,
    new Set(block.sets.map((set) => set.id)),
  );
  if (!hasConfirmedWork) {
    return { status: 'not-resolvable' };
  }
  const resolved = await planStore.resolvePlanBlock({ planExerciseId, status: 'completed', now });
  return resolved ? { status: 'completed', resolvedAt: now } : { status: 'not-resolvable' };
};

export const skipPlanBlock = async (
  planExerciseId: string,
  now: Date = new Date(),
): Promise<ResolvePlanBlockResult> => {
  const block = await planStore.loadPlanBlock(planExerciseId);
  if (!block) {
    return { status: 'block-not-found' };
  }
  if (block.exercise.progressStatus !== 'pending') {
    return { status: 'not-resolvable' };
  }
  const hasConfirmedWork = await confirmedSourceDerivedSets(
    planExerciseId,
    new Set(block.sets.map((set) => set.id)),
  );
  if (hasConfirmedWork) {
    // Performed source-derived work exists: complete the block instead of
    // skipping it — skip never claims or discards done work.
    return { status: 'not-resolvable' };
  }
  const resolved = await planStore.resolvePlanBlock({ planExerciseId, status: 'skipped', now });
  return resolved ? { status: 'skipped', resolvedAt: now } : { status: 'not-resolvable' };
};

/**
 * The recorder's Complete-block offer reads this before it shows: a block
 * that is already resolved (completed or skipped) never offers resolution
 * again. Read-only; the resolution itself stays with `completePlanBlock`.
 */
export const loadPlanBlockProgressStatus = async (
  planExerciseId: string,
): Promise<'pending' | 'completed' | 'skipped' | 'not-found'> => {
  const block = await planStore.loadPlanBlock(planExerciseId);
  if (!block) {
    return 'not-found';
  }
  return block.exercise.progressStatus;
};
