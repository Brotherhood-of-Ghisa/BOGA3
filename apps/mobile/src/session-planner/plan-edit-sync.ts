import { planQueries, type PlanDetailView } from './plan-queries';
import type { PlanFormState } from './plan-form-model';
import { planFormToDraft } from './plan-form-model';
import { validatePlanExerciseDraft } from './plan-validation';
import { planRepository, type PlanMutationResult } from './plan-repository';
import type { PlanExerciseDraft, PlanFieldError } from './types';

/**
 * An edit of one plan, composed from the repository's guarded operations —
 * never a whole-graph rewrite. Consumed blocks (attached or resolved) are
 * read-only snapshots: the whole diff — changes, deletions and the order the
 * form shows — is checked against the loaded detail FIRST, so touching one
 * refuses the edit with `immutable-block` and writes nothing. Meta (title,
 * schedule, gym) is authored intent and always editable.
 *
 * The form's blocks carry the plan block id they came from
 * (`sourceBlockId`); the diff is positional: removed blocks delete, added
 * blocks are created, kept-and-changed blocks rewrite in place, and the
 * form's full order — kept blocks and new blocks together — is written as
 * one reorder, so a block added between others lands where the form showed
 * it, not appended.
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

  const plan = planBlockOperations(detail, form, prepared.draft.exercises);
  if (plan.kind === 'validation-failed') {
    return { status: 'validation-failed', errors: plan.errors };
  }
  if (plan.touchesConsumed) {
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

  // Adds return their new block ids, which slot into the intended order.
  const addedIdsByFormIndex = new Map<number, string>();
  for (const op of plan.operations) {
    const result =
      op.kind === 'add'
        ? await planRepository.addPlanBlock(planId, op.draft)
        : op.kind === 'update'
          ? await planRepository.updatePlanBlock(op.id, op.draft)
          : await planRepository.deletePlanBlock(op.id);
    if (result.status !== 'saved' && result.status !== 'updated') {
      return result;
    }
    if (op.kind === 'add' && result.status === 'saved') {
      addedIdsByFormIndex.set(op.formIndex, result.id);
    }
  }

  // The intended final order is the form's order — a block added between
  // kept blocks must land there, not appended after them. When blocks are only
  // appended at the end and kept blocks retain their order, no reorder is needed
  // (new blocks are naturally appended by addPlanBlock), avoiding refusal on
  // plans containing consumed blocks.
  if (plan.orderChanged) {
    const intendedOrder = form.blocks
      .map((block, index) => block.sourceBlockId ?? addedIdsByFormIndex.get(index) ?? null)
      .filter((id): id is string => id !== null);
    const reordered = await planRepository.reorderPlanBlocks(planId, intendedOrder);
    if (reordered.status !== 'saved' && reordered.status !== 'updated') {
      return reordered;
    }
  }
  return { status: 'updated' };
};

export type BlockOp =
  | { kind: 'add'; formIndex: number; draft: PlanExerciseDraft }
  | { kind: 'update'; id: string; draft: PlanExerciseDraft }
  | { kind: 'delete'; id: string };

type PlanBlockDiff =
  | {
      kind: 'planned';
      operations: BlockOp[];
      touchesConsumed: boolean;
      orderChanged: boolean;
    }
  | { kind: 'validation-failed'; errors: PlanFieldError[] };

/** The positional block diff of one edit, against the loaded detail. */
const planBlockOperations = (
  detail: PlanDetailView,
  form: PlanFormState,
  drafts: PlanExerciseDraft[],
): PlanBlockDiff => {
  const blocksById = new Map(detail.blocks.map((block) => [block.id, block]));
  const keptIds: string[] = [];
  const addedFormIndexes: number[] = [];
  const adds: BlockOp[] = [];
  const updates: BlockOp[] = [];
  const deletes: BlockOp[] = [];

  for (let index = 0; index < form.blocks.length; index += 1) {
    const sourceId = form.blocks[index].sourceBlockId ?? null;
    const draft = drafts[index];
    const existing = sourceId !== null ? blocksById.get(sourceId) : undefined;
    if (existing === undefined) {
      adds.push({ kind: 'add', formIndex: index, draft });
      addedFormIndexes.push(index);
      continue;
    }
    const normalized = validatePlanExerciseDraft(draft);
    if (!normalized.ok) {
      return { kind: 'validation-failed', errors: normalized.errors };
    }
    if (blockDiffers(existing, normalized.value.exercise)) {
      updates.push({ kind: 'update', id: existing.id, draft });
    }
    keptIds.push(existing.id);
  }
  for (const block of detail.blocks) {
    if (!keptIds.includes(block.id)) {
      deletes.push({ kind: 'delete', id: block.id });
    }
  }
  // Delete removed blocks before adding new ones so replacements stay under the plan's block limit.
  const operations: BlockOp[] = [...deletes, ...updates, ...adds];

  const updateOrDeleteTouchesConsumed = operations.some(
    (op) =>
      (op.kind === 'update' || op.kind === 'delete') &&
      blocksById.get(op.id)?.status !== 'pending',
  );
  // Reordering is part of the same refusal: kept blocks changing position,
  // or a new block landing before one, reshuffles the read-only sequence of
  // a plan with a consumed block — so the whole edit refuses pre-write.
  const keptInDetailOrder = detail.blocks.map((block) => block.id).filter((id) => keptIds.includes(id));
  const addedBeforeKept = addedFormIndexes.some((addedIndex) =>
    form.blocks.some(
      (block, formIndex) =>
        formIndex > addedIndex && block.sourceBlockId !== null && blocksById.has(block.sourceBlockId),
    ),
  );
  const orderChanged =
    keptIds.some((id, index) => id !== keptInDetailOrder[index]) || addedBeforeKept;
  const touchesConsumed =
    updateOrDeleteTouchesConsumed ||
    (orderChanged && detail.blocks.some((block) => block.status !== 'pending'));
  return { kind: 'planned', operations, touchesConsumed, orderChanged };
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
