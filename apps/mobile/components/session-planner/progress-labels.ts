import type { PlanSummaryView } from '@/src/session-planner';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { formatLocalDateTime, formatShortDate } from '@/src/utils/local-time';
import { latestRoutineOutcome, type RoutineUseSummary } from '@/src/session-planner/routine-outcomes';

export const routineDateLabel = (at: Date | null, dateFormat: ExerciseDateFormat): string =>
  at === null ? 'Date unavailable' : formatShortDate(at, dateFormat);

export const routineOutcomeLine = (summary: RoutineUseSummary, dateFormat: ExerciseDateFormat): string => {
  const outcome = latestRoutineOutcome(summary);
  if (outcome) return `Last ${outcome.kind} · ${routineDateLabel(outcome.at, dateFormat)}`;
  if (summary.activeSessionId) return 'In progress';
  return summary.hasKnownUse ? 'No completed uses' : 'Never used';
};

export const progressLabel = (progress: PlanSummaryView['progress']): string => ({
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
})[progress];

export const planOutcomeLabel = (plan: Pick<PlanSummaryView, 'progress' | 'blockCounts'>): string =>
  plan.progress === 'completed' && plan.blockCounts.completed === 0
    ? 'Skipped'
    : progressLabel(plan.progress);

/** The list shows resolution day for a resolved plan, schedule otherwise. */
export const planDateLabel = (plan: PlanSummaryView, dateFormat: ExerciseDateFormat): string => {
  if (plan.progress === 'completed') {
    return plan.completedAt === null ? '' : formatShortDate(plan.completedAt, dateFormat);
  }
  return plan.scheduledFor === null ? 'Unscheduled' : formatLocalDateTime(plan.scheduledFor.getTime(), dateFormat);
};

export const blockCountsLabel = (counts: PlanSummaryView['blockCounts']): string => {
  const total = counts.pending + counts.attached + counts.completed + counts.skipped;
  return `${total} ${total === 1 ? 'block' : 'blocks'} · ${counts.completed} completed · ${counts.skipped} skipped`;
};
