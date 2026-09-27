import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Card, UiText, uiSpace } from '@/components/ui';
import { formatBoardDate, formatMemberName } from '@/src/groups';
import { describeGroupPerformanceWeight, describeGroupRules, formatGroupMetricValue, formatGroupRawPerformance, GROUP_METRIC_LABELS } from '@/src/groups/metric-view-model';
import type { GroupMetricStreamItemWire } from '@/src/groups/metric-wire';

/** Event values belong to their recorded rules; opening history preserves that revision. */
export function GroupMetricStreamCard({ item, userId, showGroupName }: {
  item: GroupMetricStreamItemWire; userId: string | null; showGroupName: boolean;
}) {
  const router = useRouter();
  const who = item.member?.user_id === userId ? 'You' : formatMemberName(item.member?.username);
  const context = `${item.group_exercise.name} · Rules ${item.rules_revision}`;
  const label = item.kind === 'rules_change' ? 'Group rules changed' : item.kind === 'record' ? item.voided
    ? 'Record removed' : item.provisional ? 'Record · session in progress' : 'New record'
    : item.kind === 'record_voided' ? 'Record removed' : item.kind === 'link'
      ? `${who} ${item.event === 'unlink' ? 'unlinked' : 'linked'} ${item.exercise_definition_ids.length} exercise${item.exercise_definition_ids.length === 1 ? '' : 's'}`
      : 'Leaderboard changed';
  const metric = item.kind === 'record' ? item.boards[0]?.metric : item.group_exercise.default_metric;
  const details: string[] = [];
  if (item.kind === 'record') {
    details.push(...item.boards.map(board => `${GROUP_METRIC_LABELS[board.metric]} · ${formatGroupMetricValue(board)}${board.group_record ? ' · group record' : ''}`));
    details.push(`As logged: ${formatGroupRawPerformance(item.performance)}`);
    details.push(`Session body weight: ${describeGroupPerformanceWeight(item.performance)}`);
    if (item.voided) details.push('This performance no longer counts. Its original event remains in history.');
  } else if (item.kind === 'record_voided') {
    details.push(`The set was ${item.reason === 'deleted' ? 'deleted' : 'corrected'}. Its original record no longer counts.`);
    details.push(...item.leaders.map(entry => `${GROUP_METRIC_LABELS[entry.metric]} · ${entry.leader
      ? `${formatMemberName(entry.leader.member.username)} leads with ${formatGroupMetricValue(entry.leader)}` : 'no current leader'}`));
  } else if (item.kind === 'link') {
    details.push('The comparison changed after linking. This is not a newly performed set.');
    details.push(...item.effects.map(effect => `${GROUP_METRIC_LABELS[effect.metric]}: ${effect.before ? formatGroupMetricValue(effect.before) : 'not ranked'} → ${effect.after ? formatGroupMetricValue(effect.after) : 'not ranked'}`));
  } else if (item.kind === 'rules_change') {
    details.push(`Rules ${item.previous_revision} → ${item.rules_revision}. The whole board was recalculated; this is not a newly performed record.`);
    // The stream carries the rule subset; describeGroupRules uses only those fields.
    details.push(describeGroupRules({ ...item.group_exercise, ...item.rules }));
  }
  const accessibilityLabel = [showGroupName ? item.group.name : null, label, item.kind === 'record' ? who : null, context,
    ...details, formatBoardDate(item.sort_at_ms), 'Opens this rules revision in history'].filter(Boolean).join(', ');
  return <Card accessibilityLabel={accessibilityLabel} testID={`group-metric-stream-${item.key}`} style={{ padding: uiSpace.md, gap: uiSpace.sm }}
    onPress={() => router.push(`/group/${item.group.group_id}/leaderboards/${item.group_exercise_id}/history?metric=${metric}&scope=all&revision=${item.rules_revision}`)}>
    {showGroupName ? <UiText variant="subtitle">{item.group.name}</UiText> : null}
    <UiText variant="label">{label}</UiText>
    <UiText>{item.kind === 'record' ? `${who} · ` : ''}{context}</UiText>
    <View style={{ gap: uiSpace.xs }}>{details.map((detail, index) => <UiText key={index} variant="bodyMuted">{detail}</UiText>)}</View>
    <UiText variant="subtitle">{formatBoardDate(item.sort_at_ms)} · View rules history</UiText>
  </Card>;
}
