import { planQueries, type PlanBlockView } from './plan-queries';

/**
 * The picker's "From planner" read model: the authored one-off blocks the
 * active session can still consume, composed from the existing plan queries —
 * no new store operation. A block is offerable when it is pending, references
 * an owned exercise definition (the performed card and card matching both
 * require it), and carries at least one target; attachment state inside a live
 * performed session is the materialization call's concern, not the list's.
 *
 * Programme-child plans are out of scope here: the programmes' own screens
 * own their blocks' consumption (the one-off planner surface lists standalone
 * plans only, and the picker's section is its entry point).
 */

export type AvailablePlanBlockView = {
  planId: string;
  planTitle: string;
  /** The plan's total block count, for the quiet `Block N of M` source line. */
  planBlockCount: number;
  block: PlanBlockView;
};

export const listAvailablePlanBlocks = async (): Promise<AvailablePlanBlockView[]> => {
  const [upcoming, unscheduled, programmes] = await Promise.all([
    planQueries.listUpcomingPlans(),
    planQueries.listUnscheduledPlans(),
    planQueries.listProgrammeSummaries(),
  ]);
  const [planDetails, programmeDetails] = await Promise.all([
    Promise.all([...upcoming, ...unscheduled].map((summary) => planQueries.loadPlanDetail(summary.id))),
    Promise.all(programmes.map((p) => planQueries.loadProgrammeDetail(p.id))),
  ]);
  const rows: AvailablePlanBlockView[] = [];
  for (const detail of planDetails) {
    if (!detail) {
      continue;
    }
    for (const block of detail.blocks) {
      if (block.status === 'pending' && block.exerciseDefinitionId !== null && block.targets.length > 0) {
        rows.push({
          planId: detail.id,
          planTitle: detail.title,
          planBlockCount: detail.blocks.length,
          block,
        });
      }
    }
  }
  for (const prog of programmeDetails) {
    if (!prog) {
      continue;
    }
    for (const plan of prog.plans) {
      for (const block of plan.blocks) {
        if (block.status === 'pending' && block.exerciseDefinitionId !== null && block.targets.length > 0) {
          if (rows.some((existing) => existing.block.id === block.id)) {
            continue;
          }
          rows.push({
            planId: plan.id,
            planTitle: `${prog.name} · ${plan.title}`,
            planBlockCount: plan.blocks.length,
            block,
          });
        }
      }
    }
  }
  return rows;
};
