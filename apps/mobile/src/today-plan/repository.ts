// Today's Plan read: each muscle's working sets per day from the stats
// aggregation, the scheduled plans from the planner's read models, and the
// muscles a plan works from the exercise catalogue. Nothing here writes.

import { computeMuscleDailySets as defaultComputeMuscleDailySets, type ComputeMuscleDailySetsOptions, type MuscleDailySets } from '@/src/data';
import {
  ensureExerciseCatalogLoaded,
  getExerciseCatalogSnapshot,
  type ExerciseCatalogCacheSnapshot,
} from '@/src/exercise-catalog/cache';
import { reportedExerciseMuscles } from '@/src/exercise-catalog/reported-muscles';
import { planQueries as defaultPlanQueries, type PlanDetailView, type PlanSummaryView } from '@/src/session-planner';

import {
  deriveRecoveryRows,
  derivePlanWeek,
  NEXT_PLANNED_LIMIT,
  selectNextPlans,
  todayPlanWindow,
  type PlanWeekDay,
  type RecoveryRow,
  type RecoveryTargets,
} from './calculations';

export type NextPlannedSession = {
  planId: string;
  title: string;
  scheduledFor: Date;
  exerciseCount: number;
  /** Its target sets. */
  setCount: number;
  /** The primary muscles its exercises work, in exercise order, each once. */
  muscles: string[];
};

export type TodayPlan = {
  /** The recovery days, oldest first. */
  recoveryDays: Date[];
  /** Today's 00:00, the recovery card's last column. */
  today: Date;
  muscles: RecoveryRow[];
  week: PlanWeekDay[];
  next: NextPlannedSession[];
};

export type TodayPlanOptions = RecoveryTargets & { countSecondary: boolean };

export type TodayPlanDependencies = {
  computeMuscleDailySets: (options: ComputeMuscleDailySetsOptions) => Promise<MuscleDailySets>;
  planQueries: {
    listUpcomingPlans: () => Promise<PlanSummaryView[]>;
    loadPlanDetail: (planId: string) => Promise<PlanDetailView | null>;
  };
  loadCatalog: () => Promise<ExerciseCatalogCacheSnapshot>;
};

const loadCatalog = async (): Promise<ExerciseCatalogCacheSnapshot> => {
  await ensureExerciseCatalogLoaded();
  const catalog = getExerciseCatalogSnapshot();
  if (catalog.status === 'error') throw new Error(catalog.lastError ?? 'Unable to load exercise catalog.');
  return catalog;
};

type CatalogExercises = Map<string, ExerciseCatalogCacheSnapshot['exercises'][number]>;

const primaryMuscleNames = (plan: PlanDetailView, catalog: ExerciseCatalogCacheSnapshot, exercisesById: CatalogExercises): string[] => {
  const names = new Set<string>();
  for (const block of plan.blocks) {
    const exercise = block.exerciseDefinitionId === null ? undefined : exercisesById.get(block.exerciseDefinitionId);
    if (!exercise) continue;
    for (const muscle of reportedExerciseMuscles(exercise, catalog.muscleSetup.assignment)) {
      const name = muscle.role === 'primary'
        ? catalog.muscleSetup.musclesById[muscle.muscleGroupId]?.displayName ?? catalog.muscleGroupsById[muscle.muscleGroupId]?.displayName
        : undefined;
      if (name !== undefined) names.add(name);
    }
  }
  return [...names];
};

const toNextPlannedSession = (
  plan: PlanDetailView, scheduledFor: Date, catalog: ExerciseCatalogCacheSnapshot, exercisesById: CatalogExercises,
): NextPlannedSession => ({
  planId: plan.id,
  title: plan.title,
  scheduledFor,
  exerciseCount: plan.blocks.length,
  setCount: plan.blocks.reduce((total, block) => total + block.targets.length, 0),
  muscles: primaryMuscleNames(plan, catalog, exercisesById),
});

export const createTodayPlanRepository = (
  dependencies: TodayPlanDependencies = { computeMuscleDailySets: defaultComputeMuscleDailySets, planQueries: defaultPlanQueries, loadCatalog },
) => ({
  async loadTodayPlan(now: Date, options: TodayPlanOptions): Promise<TodayPlan> {
    const window = todayPlanWindow(now);
    const [daily, upcoming] = await Promise.all([
      // The workout in progress counts today (§2).
      dependencies.computeMuscleDailySets({ ...window.read, now, countSecondary: options.countSecondary }),
      dependencies.planQueries.listUpcomingPlans(),
    ]);
    const scheduled = upcoming.flatMap((plan) => plan.scheduledFor === null ? [] : [{
      planId: plan.id, title: plan.title, scheduledFor: plan.scheduledFor, completed: plan.progress === 'completed',
    }]);
    const shown = selectNextPlans(scheduled, window).slice(0, NEXT_PLANNED_LIMIT);
    const [details, catalog] = shown.length === 0
      ? [[], null]
      : await Promise.all([
          Promise.all(shown.map((plan) => dependencies.planQueries.loadPlanDetail(plan.planId))),
          dependencies.loadCatalog(),
        ]);
    const exercisesById: CatalogExercises = new Map(catalog?.exercises.map((exercise) => [exercise.id, exercise]));
    const next = shown.flatMap((plan, index) => {
      const detail = details[index];
      return detail && catalog ? [toNextPlannedSession(detail, plan.scheduledFor, catalog, exercisesById)] : [];
    });
    return {
      recoveryDays: window.recoveryDays,
      today: window.today,
      muscles: deriveRecoveryRows(daily, window, options),
      week: derivePlanWeek(window, daily.sessionDays, scheduled),
      next,
    };
  },
});

const defaultTodayPlanRepository = createTodayPlanRepository();

export const loadTodayPlan = defaultTodayPlanRepository.loadTodayPlan;
