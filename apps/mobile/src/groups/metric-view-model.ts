import { formatCurrentDateTime } from '@/src/session-recorder/session-model';
// Presentation only: server order, score, metric and rule revision are preserved.
import { sessionWeightSourceLabel } from '@/src/bodyweight/weight-entry';
import { buildPodiumCards, formatEmptyBoardLabel, type PodiumCardViewModel, formatBoardDate, formatBoardMemberLabel, formatOrdinal, type BoardRowViewModel, type GroupBoardScope } from './board-view-model';
import { formatMemberName } from './stream-view-model';
import type { GroupMetric, GroupMetricValue } from './metric-contract';
import type { GroupMetricBoardRowWire, GroupMetricPodiumWire, GroupMetricEventWire, GroupMetricExerciseWire, GroupPerformanceSnapshotWire } from './metric-wire';

export const GROUP_METRIC_LABELS: Readonly<Record<GroupMetric, string>> = {
  weight: 'Weight', e1rm: '1RM', bodyweight_reps: 'Reps', relative_strength: 'Relative strength', absolute_strength: 'Absolute strength',
};
export const GROUP_METRIC_VIEW_LABELS: Readonly<Record<GroupMetric, string>> = {
  weight: 'Weight kg', e1rm: '1RM kg', bodyweight_reps: 'Reps', relative_strength: 'Relative strength ×BW', absolute_strength: 'Absolute strength kg',
};
export const GROUP_METRIC_SHORT_LABELS: Readonly<Record<GroupMetric, string>> = {
  weight: 'Weight', e1rm: '1RM', bodyweight_reps: 'Reps', relative_strength: 'Relative ×BW', absolute_strength: 'Absolute kg',
};
export function formatGroupMetricValue(score: GroupMetricValue): string {
  if (!Number.isFinite(score.value) || score.value <= 0) return 'Unavailable';
  if (score.metric === 'bodyweight_reps') return `${score.value} reps`;
  return score.metric === 'relative_strength' ? `${score.value.toFixed(2)} ×BW` : `${score.value.toFixed(1)} kg`;
}
export function formatGroupRawPerformance(performance: GroupPerformanceSnapshotWire): string {
  const mode = performance.external_load_mode === 'assistance' ? 'Assistance'
    : performance.external_load_mode === 'unquantified_assistance' ? 'Unquantified assistance' : 'Added';
  const distribution = performance.source_load_input_mode === 'per_side_load' ? ' per side' : '';
  return `${mode} ${performance.weight_value} ${performance.weight_unit}${distribution} × ${performance.reps}`;
}
export function describeGroupPerformanceWeight(performance: GroupPerformanceSnapshotWire): string {
  if (performance.body_weight_status === 'invalid') return 'Session weight unavailable · invalid saved context';
  // Retired evidence is displayed with its original source, never used to score.
  const source = performance.body_weight_source === 'manual' ? 'Original manual entry'
    : performance.body_weight_source === 'historical_estimate' ? `Estimated from ${formatCurrentDateTime(new Date(performance.body_weight_measured_at_ms!))}`
    : sessionWeightSourceLabel({ bodyWeightKg: performance.body_weight_kg, bodyWeightSource: performance.body_weight_source,
    bodyWeightMeasurementId: performance.body_weight_measurement_id,
    bodyWeightMeasuredAt: performance.body_weight_measured_at_ms === null ? null : new Date(performance.body_weight_measured_at_ms) });
  return performance.body_weight_kg === null ? source : `${Number(performance.body_weight_kg.toFixed(3))} kg · ${source}`;
}
export function describeGroupRules(exercise: Pick<GroupMetricExerciseWire, 'rules_revision' | 'bodyweight_coefficient' | 'movement_standard' | 'loading_method' | 'load_input_mode'>): string {
  const parts = [`Rules ${exercise.rules_revision}`, `${Math.round(exercise.bodyweight_coefficient * 10000) / 100}% bodyweight`,
    exercise.movement_standard, exercise.loading_method,
    exercise.load_input_mode === 'per_side_load' ? 'per-side external weight' : 'total external weight'];
  return parts.filter(Boolean).join(' · ');
}
export function buildGroupMetricRow(row: GroupMetricBoardRowWire, scope: GroupBoardScope, myUserId: string | null,
  nowMs: number = Date.now()): BoardRowViewModel {
  const memberLabel = formatBoardMemberLabel(row.member, row.former, myUserId);
  const valueLabel = formatGroupMetricValue(row);
  const detailLabel = formatGroupRawPerformance(row.performance);
  const dateLabel = formatBoardDate(row.achieved_at_ms, nowMs);
  const certification = scope === 'all' ? row.certified ? 'certified' : 'uncertified' : null;
  return { key: row.member.user_id, rank: row.rank, rankLabel: String(row.rank), memberLabel,
    isMe: row.member.user_id === myUserId, former: row.former, valueLabel, detailLabel, dateLabel, certification,
    accessibilityLabel: [formatOrdinal(row.rank),memberLabel,GROUP_METRIC_LABELS[row.metric],valueLabel,
      detailLabel,dateLabel,certification,`rules revision ${row.rules_revision}`].filter(Boolean).join(', ') };
}
export function describeGroupMetricHistory(event: GroupMetricEventWire, myUserId: string | null): string {
  if (event.kind === 'rules_change') return `Rules changed from revision ${event.previous_revision} to ${event.rules_revision}. The board was recalculated under the shared standard.`;
  if (event.kind !== 'lead_change') return '';
  const who = event.leader ? event.leader.member.user_id === myUserId ? 'You' : formatMemberName(event.leader.member.username) : null;
  const cause = event.reason === 'link' ? 'after a link change' : event.reason === 'void' ? 'after a corrected or removed set'
    : event.reason === 'certification' ? 'after a certification change' : 'with a new record';
  return event.leader ? `${who} took #1 · ${formatGroupMetricValue(event.leader)} ${cause}.` : `No one holds #1 ${cause}.`;
}


export function buildGroupMetricPodiums(payload: GroupMetricPodiumWire, myUserId: string | null,
  nowMs: number = Date.now()): PodiumCardViewModel[] {
  return payload.exercises.map(card => {
    if (card.legacy) return buildPodiumCards({ metric: 'e1rm', certified: true, exercises: [card.board] }, myUserId, nowMs)[0];
    const { exercise } = card;
    const rows = card.state === 'rebuilding' ? [] : card.podium.map(row => ({ key: row.member.user_id,
      rank: row.rank, memberLabel: formatBoardMemberLabel(row.member, row.former, myUserId),
      isMe: row.member.user_id === myUserId, valueLabel: formatGroupMetricValue(row),
      dateLabel: formatBoardDate(row.achieved_at_ms, nowMs) }));
    const viewLabel = `${card.certified ? 'Certified' : 'All'} · ${GROUP_METRIC_VIEW_LABELS[card.metric]} · Rules ${card.rules_revision}`;
    const emptyLabel = card.state === 'rebuilding' ? 'Recalculating under the new rules…'
      : rows.length === 0 ? formatEmptyBoardLabel(card.certified, card.all_entry_count) : null;
    const youLabel = card.state === 'rebuilding' ? null : card.me && card.me.rank > 3 ? `You: ${formatOrdinal(card.me.rank)}`
      : !card.me && rows.length > 0 ? 'You: not ranked' : null;
    const archived = exercise.archived_at_ms !== null;
    return { exerciseId: exercise.group_exercise_id, name: exercise.name, archived, viewLabel, rows, emptyLabel, youLabel,
      accessibilityLabel: [exercise.name, archived ? 'archived' : null, viewLabel,
        ...rows.map(row => `${formatOrdinal(row.rank)} ${row.memberLabel} ${row.valueLabel} ${row.dateLabel}`),
        emptyLabel, youLabel].filter(Boolean).join(', ') };
  });
}

/** Legacy event payloads retain kg-only meaning; never infer missing bodyweight inputs. */
export function describeLegacyMetricHistory(event: import('./metric-wire').GroupLegacyMetricHistoryWire, userId: string | null): string {
  const holder = event.payload.leader;
  if (!holder || typeof holder !== 'object') return 'No one holds #1 under these original kg-only rules.';
  const row = holder as Record<string, unknown>;
  const member = row.member && typeof row.member === 'object' ? row.member as Record<string, unknown> : null;
  const name = row.member_user_id === userId ? 'You' : formatMemberName(typeof member?.username === 'string' ? member.username : null);
  const value = typeof row.value_kg === 'number' && Number.isFinite(row.value_kg) ? ` · ${row.value_kg.toFixed(1)} kg` : '';
  const reason = event.reason === 'link' ? 'after a link change' : event.reason === 'void' ? 'after a corrected or removed set'
    : event.reason === 'certification' ? 'after a certification change' : 'with a new record';
  return `${name} took #1${value} ${reason}. Original kg-only rules.`;
}
