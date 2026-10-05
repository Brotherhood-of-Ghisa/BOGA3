// Presentation preserves server values, ordering, units and public disclosure.
import { formatWeight } from '@/src/exercise-calculations/format';
import { formatBoardDate, formatBoardMemberLabel, formatOrdinal,
  type BoardRowViewModel, type GroupBoardScope, type PodiumCardViewModel } from './board-view-model';
import { competitionUnit, type CompetitionMetric, type CompetitionValue } from './competition-contract';
import type { CompetitionBoardRowWire, CompetitionEventWire,CompetitionHistoryValueWire, CompetitionExerciseWire,
  CompetitionHistoricalMetric, CompetitionPerformanceWire, CompetitionPodiumsWire, CompetitionRulesWire } from './competition-wire';
import { formatMemberName, formatMetricFigure } from './stream-view-model';
import type { GroupExercise } from './types';

export const COMPETITION_LABELS = { volume: 'Volume', e1rm: '1RM' } as const;
export const COMPETITION_UNIT_LABELS = { kg_reps: 'kg·reps', kg: 'kg', percent_bw_reps: '%BW·reps', percent_bw: '%BW' } as const;
export const HISTORICAL_METRIC_LABELS: Record<CompetitionHistoricalMetric,string> = {
  weight: 'Weight',volume: 'Volume',e1rm: '1RM',bodyweight_reps: 'Bodyweight reps',
  relative_strength: 'Relative strength',absolute_strength: 'Absolute strength',
};
export function competitionViewLabel(metric: CompetitionMetric,rules: CompetitionRulesWire): string {
  return `${COMPETITION_LABELS[metric]} ${COMPETITION_UNIT_LABELS[competitionUnit(metric,
    rules.bodyweight_calculations_enabled && rules.bodyweight_contribution > 0)]}`;
}
export function formatCompetitionValue(score: Pick<CompetitionValue,'metric'|'unit'|'value'>): string {
  if (!Number.isFinite(score.value) || score.value <= 0) return 'Score unavailable';
  return `${formatMetricFigure('e1rm',score.value)} ${COMPETITION_UNIT_LABELS[score.unit]}`;
}
export function formatCompetitionPerformance(performance: CompetitionPerformanceWire): string {
  if (performance.visibility === 'normalized') return `${performance.reps} reps`;
  const distribution = performance.source_load_input_mode === 'per_side_load' ? ' per side' : '';
  const value = Number(performance.weight_value);
  return `Weight ${Number.isFinite(value) ? formatWeight(value) : performance.weight_value} kg${distribution} × ${performance.reps}`;
}
export const formatContributionPercent = (contribution: number): string =>
  String(Number((contribution * 100).toPrecision(15)));

export function describeCompetitionRules(exercise: { rules: Omit<CompetitionRulesWire,'default_metric'> }): string {
  const r=exercise.rules;
  return `Rules ${r.rules_revision} · ${formatContributionPercent(r.bodyweight_contribution)}% contribution · Bodyweight scoring ${r.bodyweight_calculations_enabled ? 'On' : 'Off'} · ${r.load_input_mode === 'per_side_load' ? 'per-side' : 'total'} load`;
}
/** Linking consumes public catalogue identity; it never copies personal settings. */
export function competitionExerciseCore(exercise: CompetitionExerciseWire): GroupExercise {
  return { group_exercise_id: exercise.group_exercise_id,name: exercise.name,
    load_input_mode: exercise.rules.load_input_mode,source_exercise_id: exercise.source_exercise_id,
    archived_at_ms: exercise.archived_at_ms };
}
export function buildCompetitionRow(row: CompetitionBoardRowWire,scope: GroupBoardScope,userId: string | null,
  nowMs: number = Date.now()): BoardRowViewModel {
  const memberLabel=formatBoardMemberLabel(row.member,row.former,userId);
  const valueLabel=formatCompetitionValue(row);
  const detailLabel=formatCompetitionPerformance(row.performance);
  const dateLabel=formatBoardDate(row.performance.achieved_at_ms,nowMs);
  const certification=scope === 'all' ? row.certification ? 'certified' : 'uncertified' : null;
  return { key: row.member.user_id,rank: row.rank,rankLabel: String(row.rank),memberLabel,
    isMe: row.member.user_id === userId,former: row.former,valueLabel,detailLabel,dateLabel,certification,
    accessibilityLabel: [formatOrdinal(row.rank),memberLabel,COMPETITION_LABELS[row.metric],valueLabel,
      detailLabel,dateLabel,certification].filter(Boolean).join(', ') };
}
export function buildCompetitionPodiums(payload: CompetitionPodiumsWire,userId: string | null,
  nowMs: number = Date.now()): PodiumCardViewModel[] {
  return payload.podiums.map(({ exercise,board }) => {
    const rows=board.state === 'rebuilding' ? [] : board.entries.slice(0,3).map(row => ({ key: row.member.user_id,
      rank: row.rank,memberLabel: formatBoardMemberLabel(row.member,row.former,userId),isMe: row.member.user_id === userId,
      valueLabel: formatCompetitionValue(row),dateLabel: formatBoardDate(row.performance.achieved_at_ms,nowMs) }));
    const viewLabel=`${board.certified ? 'Certified' : 'All'} · ${competitionViewLabel(board.metric,board.rules)} · Rules ${board.rules.rules_revision}`;
    const emptyLabel=board.state === 'rebuilding' ? 'Recalculating under the new rules…'
      : rows.length === 0 ? board.certified ? 'No certified sets yet' : 'Score unavailable' : null;
    const youLabel=board.state === 'rebuilding' ? null : board.me && board.me.rank > 3 ? `You: ${formatOrdinal(board.me.rank)}`
      : !board.me && rows.length > 0 ? 'You: not ranked' : null;
    const archived=exercise.archived_at_ms !== null;
    return { exerciseId: exercise.group_exercise_id,name: exercise.name,archived,viewLabel,rows,emptyLabel,youLabel,
      accessibilityLabel: [exercise.name,archived ? 'archived' : null,viewLabel,
        ...rows.map(row => `${formatOrdinal(row.rank)} ${row.memberLabel} ${row.valueLabel} ${row.dateLabel}`),emptyLabel,youLabel].filter(Boolean).join(', ') };
  });
}
export function describeCompetitionEvent(event: CompetitionEventWire,userId: string | null = null): string {
  if (event.kind === 'rules_change') return `Rules revision ${event.rules_revision}. The comparison was recalculated under the shared standard.`;
  if (event.kind === 'record_voided' || event.voided) return 'Certification ended. Score unavailable.';
  const who=event.member?.user_id === userId ? 'You' : formatMemberName(event.member?.username ?? null);
  if (event.kind === 'link' || event.kind === 'unlink') return `${who} ${event.kind === 'link' ? 'linked' : 'unlinked'} an exercise to ${event.group_exercise.name}.`;
  const value=event.values.find(row => row.role === (event.kind === 'lead_change' ? 'leader' : 'record'));
  const figure=value?.value !== null && value?.value !== undefined && !value.unavailable
    ? `${formatMetricFigure('e1rm',value.value)} ${COMPETITION_UNIT_LABELS[value.unit as keyof typeof COMPETITION_UNIT_LABELS] ?? value.unit}` : 'Score unavailable';
  const label=value ? HISTORICAL_METRIC_LABELS[value.metric] : event.metric ? HISTORICAL_METRIC_LABELS[event.metric] : 'Score';
  const holder=value?.member?.user_id === userId ? 'You' : value?.member ? formatMemberName(value.member.username) : who;
  return event.kind === 'lead_change' ? `${holder} · #1 ${label} · ${figure}.` : `${who} · ${label} ${figure}${event.reps === null ? '' : ` · ${event.reps} reps`}.`;
}

export function formatCompetitionHistoricalValue(value: CompetitionHistoryValueWire): string {
  if (value.unavailable || value.value === null) return 'Score unavailable';
  return `${HISTORICAL_METRIC_LABELS[value.metric]} ${formatMetricFigure('e1rm',value.value)} ${COMPETITION_UNIT_LABELS[value.unit as keyof typeof COMPETITION_UNIT_LABELS] ?? value.unit}`;
}

export function competitionLinkExercise(exercise: CompetitionExerciseWire): GroupExercise & { standard: string } {
  return { ...competitionExerciseCore(exercise),standard: describeCompetitionRules(exercise) };
}
