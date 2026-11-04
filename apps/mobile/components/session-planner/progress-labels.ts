import type { PlanSummaryView } from '@/src/session-planner';

export const progressLabel = (progress: PlanSummaryView['progress']): string => ({
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
})[progress];

export const planOutcomeLabel = (plan: Pick<PlanSummaryView, 'progress' | 'blockCounts'>): string =>
  plan.progress === 'completed' && plan.blockCounts.completed === 0
    ? 'Skipped'
    : progressLabel(plan.progress);

export const blockCountsLabel = (counts: PlanSummaryView['blockCounts']): string => {
  const total = counts.pending + counts.attached + counts.completed + counts.skipped;
  return `${total} ${total === 1 ? 'block' : 'blocks'} · ${counts.completed} completed · ${counts.skipped} skipped`;
};
