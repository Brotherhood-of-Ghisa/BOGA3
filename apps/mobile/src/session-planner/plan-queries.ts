import { normalizeSessionSetType, type SessionSetTypeValue } from '@/src/data/set-types';
import {
  createDrizzleSessionPlanStore,
  type PlanExerciseRow,
  type PlanRow,
  type PlanSetRow,
  type SessionPlanStore,
} from '@/src/data/session-plan-store';
import type { PlanBlockStatus } from './types';

/**
 * Read models for the planner screens: upcoming and unscheduled queues,
 * programme summaries with derived progress, plan detail with per-block
 * consumption state, and the programme's next available block. Derived only —
 * nothing here writes, and parent progress is computed from block attachment
 * and resolution on every read, never stored.
 *
 * Planned rows live in separate tables from performed workouts, so these
 * queries cannot leak into session history, stats, records or group streams;
 * the exclusion regressions prove the reverse direction (planner rows are
 * invisible to those selectors).
 */

export type PlanProgress = 'planned' | 'in_progress' | 'completed';

export type PlanTargetView = {
  id: string;
  orderIndex: number;
  targetWeightValue: string | null;
  targetReps: number;
  targetSetType: SessionSetTypeValue;
};

export type PlanBlockView = {
  id: string;
  planId: string;
  exerciseDefinitionId: string | null;
  name: string;
  machineName: string | null;
  orderIndex: number;
  /** Stored resolution state from `session_plan_exercises.progress_status`. */
  progressStatus: 'pending' | 'completed' | 'skipped';
  /** Derived screen state: a pending block with a live performed card is attached. */
  status: PlanBlockStatus;
  resolvedAt: Date | null;
  attachedSessionId: string | null;
  attachedSessionExerciseId: string | null;
  targets: PlanTargetView[];
};

export type PlanSummaryView = {
  id: string;
  title: string;
  gymId: string | null;
  scheduledFor: Date | null;
  programmeId: string | null;
  programmeOrderIndex: number | null;
  provenance: 'human' | 'agent';
  progress: PlanProgress;
  blockCounts: { pending: number; attached: number; completed: number; skipped: number };
};

export type PlanDetailView = PlanSummaryView & { blocks: PlanBlockView[] };

export type ProgrammeSummaryView = {
  id: string;
  name: string;
  description: string | null;
  progress: PlanProgress;
  planCount: number;
  blockCounts: { pending: number; attached: number; completed: number; skipped: number };
};

export type ProgrammeDetailView = ProgrammeSummaryView & {
  plans: PlanDetailView[];
  /** The earliest available block in programme-order then exercise-order; null when none. */
  nextBlock: PlanBlockView | null;
};

type BlockCounts = { pending: number; attached: number; completed: number; skipped: number };

const emptyBlockCounts = (): BlockCounts => ({ pending: 0, attached: 0, completed: 0, skipped: 0 });

const progressFromCounts = (counts: BlockCounts): PlanProgress => {
  const unresolved = counts.pending + counts.attached;
  if (unresolved === 0 && counts.completed + counts.skipped > 0) {
    return 'completed';
  }
  return counts.attached + counts.completed + counts.skipped > 0 ? 'in_progress' : 'planned';
};

/** Assembles block views from one pass of rows; `cardsByBlockId` supplies attachment. */
const toBlockViews = (
  blocks: PlanExerciseRow[],
  sets: PlanSetRow[],
  cardsByBlockId: Map<string, { sessionId: string; sessionExerciseId: string }>,
): PlanBlockView[] => {
  const setsByBlockId = sets.reduce<Map<string, PlanSetRow[]>>((acc, row) => {
    const current = acc.get(row.sessionPlanExerciseId) ?? [];
    current.push(row);
    acc.set(row.sessionPlanExerciseId, current);
    return acc;
  }, new Map());

  return blocks.map((block) => {
    const attachedCard =
      block.progressStatus === 'pending' ? (cardsByBlockId.get(block.id) ?? null) : null;
    return {
      id: block.id,
      planId: block.sessionPlanId,
      exerciseDefinitionId: block.exerciseDefinitionId,
      name: block.name,
      machineName: block.machineName,
      orderIndex: block.orderIndex,
      progressStatus: block.progressStatus,
      status:
        block.progressStatus === 'pending' && attachedCard !== null ? 'attached' : block.progressStatus,
      resolvedAt: block.resolvedAt,
      attachedSessionId: attachedCard?.sessionId ?? null,
      attachedSessionExerciseId: attachedCard?.sessionExerciseId ?? null,
      targets: (setsByBlockId.get(block.id) ?? []).map((set) => ({
        id: set.id,
        orderIndex: set.orderIndex,
        targetWeightValue: set.targetWeightValue,
        targetReps: set.targetReps,
        targetSetType: normalizeSessionSetType(set.targetSetType),
      })),
    };
  });
};

const summaryFromPlanAndBlocks = (plan: PlanRow, blocks: PlanBlockView[]): PlanSummaryView => {
  const counts = emptyBlockCounts();
  for (const block of blocks) {
    counts[block.status] += 1;
  }
  return {
    id: plan.id,
    title: plan.title,
    gymId: plan.gymId,
    scheduledFor: plan.scheduledFor,
    programmeId: plan.programmeId,
    programmeOrderIndex: plan.programmeOrderIndex,
    provenance: plan.provenance,
    progress: progressFromCounts(counts),
    blockCounts: counts,
  };
};

export const createPlanQueries = (store: SessionPlanStore = createDrizzleSessionPlanStore()) => {
  /** Loads block views (and their attachment state) for the given plans in one pass. */
  const loadBlockViewsForPlans = async (planIds: string[]): Promise<Map<string, PlanBlockView[]>> => {
    const blocks = await store.listBlocksForPlans(planIds);
    const blockIds = blocks.map((block) => block.id);
    const [sets, cards] = await Promise.all([
      store.listSetsForBlocks(blockIds),
      store.listSourcedCardsForBlocks(blockIds),
    ]);
    const cardsByBlockId = new Map(
      cards.map((card) => [card.sourcePlanExerciseId, { sessionId: card.sessionId, sessionExerciseId: card.id }]),
    );
    const views = toBlockViews(blocks, sets, cardsByBlockId);
    const byPlanId = new Map<string, PlanBlockView[]>();
    for (const view of views) {
      const current = byPlanId.get(view.planId) ?? [];
      current.push(view);
      byPlanId.set(view.planId, current);
    }
    return byPlanId;
  };

  const loadPlanSummaries = async (
    plans: PlanRow[],
  ): Promise<{ summaries: PlanSummaryView[]; blocksByPlanId: Map<string, PlanBlockView[]> }> => {
    const blocksByPlanId = await loadBlockViewsForPlans(plans.map((plan) => plan.id));
    const summaries = plans.map((plan) => summaryFromPlanAndBlocks(plan, blocksByPlanId.get(plan.id) ?? []));
    return { summaries, blocksByPlanId };
  };

  const loadProgrammeDetail = async (programmeId: string): Promise<ProgrammeDetailView | null> => {
    const programme = await store.loadProgramme(programmeId);
    if (!programme) {
      return null;
    }
    const graphs = await store.listPlanGraphsByProgramme(programmeId);
    const blocksByPlanId = await loadBlockViewsForPlans(graphs.map((graph) => graph.plan.id));
    const details = graphs.map((graph) => ({
      ...summaryFromPlanAndBlocks(graph.plan, blocksByPlanId.get(graph.plan.id) ?? []),
      blocks: blocksByPlanId.get(graph.plan.id) ?? [],
    }));
    const counts = emptyBlockCounts();
    for (const detail of details) {
      for (const block of detail.blocks) {
        counts[block.status] += 1;
      }
    }
    // Programme-order then exercise-order: plans come ordered by
    // programme_order_index and blocks by order_index, so the first pending
    // block in that sequence is the next one to offer.
    const nextBlock = details.flatMap((detail) => detail.blocks).find((block) => block.status === 'pending') ?? null;
    return {
      id: programme.id,
      name: programme.name,
      description: programme.description,
      progress: progressFromCounts(counts),
      planCount: details.length,
      blockCounts: counts,
      plans: details,
      nextBlock,
    };
  };

  return {
    /** Scheduled standalone and programme-child plans, soonest first. */
    async listUpcomingPlans(): Promise<PlanSummaryView[]> {
      const plans = (await store.listLivePlans()).filter((plan) => plan.scheduledFor !== null);
      plans.sort((a, b) => (a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0));
      const { summaries } = await loadPlanSummaries(plans);
      return summaries;
    },

    /** Unscheduled standalone plans, most recently updated first. */
    async listUnscheduledPlans(): Promise<PlanSummaryView[]> {
      const plans = (await store.listLivePlans())
        .filter((plan) => plan.scheduledFor === null && plan.programmeId === null)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      const { summaries } = await loadPlanSummaries(plans);
      return summaries;
    },

    /** Programme summaries with derived progress, most recently updated first. */
    async listProgrammeSummaries(): Promise<ProgrammeSummaryView[]> {
      const [programmes, plans] = await Promise.all([store.listProgrammes(), store.listLivePlans()]);
      const blocksByPlanId = await loadBlockViewsForPlans(plans.map((plan) => plan.id));
      return programmes
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map((programme) => {
          const programmePlans = plans.filter((plan) => plan.programmeId === programme.id);
          const counts = emptyBlockCounts();
          for (const plan of programmePlans) {
            for (const block of blocksByPlanId.get(plan.id) ?? []) {
              counts[block.status] += 1;
            }
          }
          return {
            id: programme.id,
            name: programme.name,
            description: programme.description,
            progress: progressFromCounts(counts),
            planCount: programmePlans.length,
            blockCounts: counts,
          };
        });
    },

    /** One plan with its ordered blocks and their consumption state. */
    async loadPlanDetail(planId: string): Promise<PlanDetailView | null> {
      const plan = await store.loadPlan(planId);
      if (!plan) {
        return null;
      }
      const { blocksByPlanId } = await loadPlanSummaries([plan]);
      return {
        ...summaryFromPlanAndBlocks(plan, blocksByPlanId.get(plan.id) ?? []),
        blocks: blocksByPlanId.get(plan.id) ?? [],
      };
    },

    loadProgrammeDetail,

    /** The programme's next available block, or null when nothing is available. */
    async findNextProgrammeBlock(programmeId: string): Promise<PlanBlockView | null> {
      const detail = await loadProgrammeDetail(programmeId);
      return detail?.nextBlock ?? null;
    },
  };
};

export const planQueries = createPlanQueries();
