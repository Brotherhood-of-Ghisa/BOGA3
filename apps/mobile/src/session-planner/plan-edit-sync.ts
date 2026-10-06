import { planQueries, type PlanDetailView } from './plan-queries';
import type { PlanFormState } from './plan-form-model';
import { planFormToDraft } from './plan-form-model';
import { validatePlanExerciseDraft } from './plan-validation';
import { planRepository, type PlanMutationResult } from './plan-repository';

/**
 * An edit of one plan, composed from the repository's guarded operations —
 * never a whole-graph rewrite. Consumed blocks (attached or resolved) are
 * read-only snapshots: the diff is checked against the loaded detail first,
 * so touching one refuses the whole edit with `immutable-block` and writes
 * nothing. Meta (title, schedule, gym) is authored intent and always
 * editable.
 *
 * The form's blocks carry the plan block id they came from
 * (`sourceBlockId`); the diff is positional: removed blocks delete, added
 * blocks append, kept-and-changed blocks rewrite in place, and the kept
 * order is written as one reorder.
 */
export const savePlanEdits = async (
  planId: string,
  form: PlanFormState,
): Promise<PlanMutationResult> => {
  const prepared = planFormToDraft(form);
  if (prepared.draft === null) {
    return {
      status: 'validation-failed',
      errors: [{ path: 'scheduledFor', code: 'invalid_schedule', message: prepared.scheduleError }],
    };
  }
  const detail = await planQueries.loadPlanDetail(planId);
  if (detail === null) {
    return { status: 'not-found' };
  }

  // The write plan, checked against read-only state before anything writes.
  const blocksById = new Map(detail.blocks.map((block) => [block.id, block]));
  const keptIds: string[] = [];
  type BlockOp =
    | { kind: 'add'; draft: (typeof prepared.draft.exercises)[number] }
    | { kind: 'update'; id: string; draft: (typeof prepared.draft.exercises)[number] }
    | { kind: 'delete'; id: string };
  const blockOps: BlockOp[] = [];
  for (let index = 0; index < form.blocks.length; index += 1) {
    const formBlock = form.blocks[index];
    const sourceId = formBlock.sourceBlockId ?? null;
    const draft = prepared.draft.exercises[index];
    const existing = sourceId !== null ? blocksById.get(sourceId) : undefined;
    if (existing === undefined) {
      blockOps.push({ kind: 'add', draft });
      continue;
    }
    const normalized = validatePlanExerciseDraft(draft);
    if (!normalized.ok) {
      return { status: 'validation-failed', errors: normalized.errors };
    }
    if (blockDiffers(existing, normalized.value.exercise)) {
      blockOps.push({ kind: 'update', id: existing.id, draft });
    }
    keptIds.push(existing.id);
  }
  for (const block of detail.blocks) {
    if (!keptIds.includes(block.id)) {
      blockOps.push({ kind: 'delete', id: block.id });
    }
  }
  const touchesConsumed = blockOps.some(
    (op) =>
      (op.kind === 'update' || op.kind === 'delete') &&
      blocksById.get(op.id)?.status !== 'pending',
  );
  if (touchesConsumed) {
    return { status: 'immutable-block' };
  }

  const meta = await planRepository.updatePlanMeta(planId, {
    title: prepared.draft.title,
    gymId: prepared.draft.gymId,
    scheduledFor: prepared.draft.scheduledFor,
  });
  if (meta.status !== 'updated' && meta.status !== 'saved') {
    return meta;
  }

  for (const op of blockOps) {
    const result =
      op.kind === 'add'
        ? await planRepository.addPlanBlock(planId, op.draft)
        : op.kind === 'update'
          ? await planRepository.updatePlanBlock(op.id, op.draft)
          : await planRepository.deletePlanBlock(op.id);
    if (result.status !== 'saved' && result.status !== 'updated') {
      return result;
    }
  }

  // Only a real order change reorders — and a plan with a consumed block
  // never reorders (its block sequence is a read-only snapshot too).
  const originalKeptOrder = detail.blocks.map((block) => block.id).filter((id) => keptIds.includes(id));
  const orderChanged =
    keptIds.length > 0 && (keptIds.length !== originalKeptOrder.length || keptIds.some((id, index) => id !== originalKeptOrder[index]));
  if (orderChanged) {
    const reordered = await planRepository.reorderPlanBlocks(planId, keptIds);
    if (reordered.status !== 'saved' && reordered.status !== 'updated') {
      return reordered;
    }
  }
  return { status: 'updated' };
};

const blockDiffers = (
  existing: PlanDetailView['blocks'][number],
  draft: { name: string; machineName: string | null; exerciseDefinitionId: string | null; sets: { targetWeightValue: string | null; targetReps: number; targetSetType: unknown }[] },
): boolean =>
  existing.name !== draft.name ||
  (existing.machineName ?? '') !== (draft.machineName ?? '') ||
  existing.exerciseDefinitionId !== draft.exerciseDefinitionId ||
  existing.targets.length !== draft.sets.length ||
  existing.targets.some(
    (target, index) =>
      target.targetWeightValue !== draft.sets[index].targetWeightValue ||
      target.targetReps !== draft.sets[index].targetReps ||
      target.targetSetType !== draft.sets[index].targetSetType,
  );
