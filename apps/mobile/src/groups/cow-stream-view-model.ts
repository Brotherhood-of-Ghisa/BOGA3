import type { ExerciseDateFormat } from '@/src/preferences/model';
import { formatLocalDateTime } from '@/src/utils/local-time';
import { formatBoardMemberLabel } from './board-view-model';
import { COW_METRIC_LABELS, coWAccessibleDates, coWDateRange, coWFigure, coWMetricHeading } from './cow-presentation';
import type { CoWStreamEvent, CoWStreamItemWire } from './competition-wire';

const LABELS: Record<CoWStreamEvent, string> = {
  scheduled: 'Scheduled', updated: 'Updated', cancelled: 'Cancelled', started: 'Started',
  ended: 'Ended · Finalizing', results: 'Results published', unavailable: 'Results unavailable',
};

function details(item: CoWStreamItemWire, userId: string | null): string[] {
  if (item.result) return item.result.state === 'unavailable' ? ['Group comparisons unavailable'] : item.result.rankings.map(ranking => {
    const winner=ranking.entries[0];
    const outcome=!winner ? 'No qualifying results' : `${formatBoardMemberLabel(winner.member,winner.former,userId)} · ${
      winner.value === null ? 'Unavailable' : coWFigure(winner.value,ranking.metric)}`;
    return `${coWMetricHeading(ranking)} · ${outcome}`;
  });
  const before=item.previous, after=item.definition;
  if (!before) return [after.metrics.map(metric => COW_METRIC_LABELS[metric]).join(' · ')];
  return [before.group_exercise_id !== after.group_exercise_id ? `${before.exercise_name} → ${after.exercise_name}` : null,
    before.metrics.join(',') !== after.metrics.join(',') ? `${before.metrics.map(m => COW_METRIC_LABELS[m]).join(' · ')} → ${after.metrics.map(m => COW_METRIC_LABELS[m]).join(' · ')}` : null]
    .filter((line): line is string => line !== null);
}

export function buildCoWStreamCard(item: CoWStreamItemWire, userId: string | null, dateFormat: ExerciseDateFormat) {
  const cow=item.definition;
  const label=`CoW · ${LABELS[item.event]}`;
  const week=`${coWDateRange(cow.week_start,dateFormat)} · ${cow.time_zone}`;
  const date=formatLocalDateTime(item.sort_at_ms,dateFormat);
  const lines=details(item,userId);
  return { label, exercise: cow.exercise_name, week, date, details: lines,
    accessibilityLabel: [label,cow.exercise_name,coWAccessibleDates(cow.week_start,dateFormat),cow.time_zone,...lines,date].join(', '),
    path: `/group/${cow.group_id}/cows/${cow.cow_id}` as const };
}
