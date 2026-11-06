import { readRoutineHistory } from '@/src/data/routine-history';

export type RoutineUseSummary = {
  activeSessionId: string | null;
  hasKnownUse: boolean;
  /** Undefined means absent; null means a known outcome with no recoverable date. */
  lastCompletedAt: Date | null | undefined;
  lastSkippedAt: Date | null | undefined;
};

const latestDate = (dates: (Date | null)[]): Date | null | undefined => {
  if (!dates.length) return undefined;
  const known = dates.filter((date): date is Date => date !== null && Number.isFinite(date.getTime()));
  return known.length ? new Date(Math.max(...known.map(date => date.getTime()))) : null;
};

export const loadRoutineUseSummaries = async (planIds: string[]): Promise<Map<string, RoutineUseSummary>> => {
  const { workouts, uses, knownPlanIds } = await readRoutineHistory(planIds);
  return new Map(planIds.map(planId => {
    const linked = workouts.filter(workout => workout.planId === planId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const actions = uses.filter(use => use.sessionPlanId === planId);
    return [planId, {
      activeSessionId: linked.find(workout => workout.status === 'active')?.sessionId ?? null,
      hasKnownUse: knownPlanIds.includes(planId) || actions.length > 0,
      lastCompletedAt: latestDate(linked.filter(workout => workout.status === 'completed' && workout.hasConfirmedSourceWork)
        .map(workout => workout.completedAt)),
      lastSkippedAt: latestDate(actions.filter(use => use.kind === 'skip').map(use => use.skippedAt)),
    }];
  }));
};

/** Compare actual outcome instants; use allocation and template edits are not dates. */
export const latestRoutineOutcome = (summary: RoutineUseSummary): { kind: 'completed' | 'skipped'; at: Date | null } | null => {
  const { lastCompletedAt, lastSkippedAt } = summary;
  if (lastCompletedAt === undefined && lastSkippedAt === undefined) return null;
  if (lastSkippedAt === undefined) return { kind: 'completed', at: lastCompletedAt ?? null };
  if (lastCompletedAt === undefined) return { kind: 'skipped', at: lastSkippedAt };
  return (lastSkippedAt?.getTime() ?? -Infinity) >= (lastCompletedAt?.getTime() ?? -Infinity)
    ? { kind: 'skipped', at: lastSkippedAt }
    : { kind: 'completed', at: lastCompletedAt };
};
