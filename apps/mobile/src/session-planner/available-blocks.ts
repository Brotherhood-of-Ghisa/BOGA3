import { planQueries, type PlanBlockView, type PlanDetailView, type ProgrammeDetailView } from './plan-queries';

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

/** Pending, references an owned definition, and carries at least one target. */
const isOfferable = (block: PlanBlockView): boolean =>
  block.status === 'pending' && block.exerciseDefinitionId !== null && block.targets.length > 0;

/** The offerable blocks of one plan, titled as `title` names it. */
const rowsOfPlan = (plan: PlanDetailView, title: string): AvailablePlanBlockView[] =>
  plan.blocks.filter(isOfferable).map((block) => ({
    planId: plan.id,
    planTitle: title,
    planBlockCount: plan.blocks.length,
    block,
  }));

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
  const rows = planDetails
    .filter((detail): detail is PlanDetailView => detail !== null)
    .flatMap((detail) => rowsOfPlan(detail, detail.title));
  // A standalone plan and a programme child can reach one block; the first
  // row for it stands, so a programme never re-lists what is already offered.
  const seen = new Set(rows.map((row) => row.block.id));
  const fromProgrammes = programmeDetails
    .filter((prog): prog is ProgrammeDetailView => prog !== null)
    .flatMap((prog) => prog.plans.flatMap((plan) => rowsOfPlan(plan, `${prog.name} · ${plan.title}`)));
  for (const row of fromProgrammes) {
    if (!seen.has(row.block.id)) {
      seen.add(row.block.id);
      rows.push(row);
    }
  }
  return rows;
};
