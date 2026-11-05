import type { PlanSummaryView } from '@/src/session-planner';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { formatLocalDateTime, formatShortDate } from '@/src/utils/local-time';

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
