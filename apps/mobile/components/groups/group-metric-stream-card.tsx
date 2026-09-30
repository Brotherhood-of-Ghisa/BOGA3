import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Icon, Tag, uiBorder, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { formatBoardDate, formatMemberName } from '@/src/groups';
import { describeGroupRules, formatGroupMetricValue, formatGroupRawPerformance, GROUP_METRIC_LABELS } from '@/src/groups/metric-view-model';
import type { GroupMetricStreamItemWire } from '@/src/groups/metric-wire';
import { GroupCertificationStatus } from './certification-status';

/** Event values belong to their recorded rules; opening history preserves that revision. */
export function GroupMetricStreamCard({ item, userId, showGroupName, onPress, pressHint }: {
  onPress?: () => void; pressHint?: string;
  item: GroupMetricStreamItemWire; userId: string | null; showGroupName: boolean;
}) {
  const router = useRouter();
  const who = item.member?.user_id === userId ? 'You' : formatMemberName(item.member?.username);
  const context = `${item.group_exercise.name} · Rules ${item.rules_revision}`;
  const label = item.kind === 'rules_change' ? 'Group rules changed' : item.kind === 'record' ? item.voided
    ? 'Record removed' : `${who} — ${item.boards.some(board => board.group_record) ? 'group record' : 'personal record'}`
    : item.kind === 'record_voided' ? 'Record removed' : item.kind === 'link'
      ? `${who} ${item.event === 'unlink' ? 'unlinked' : 'linked'} ${item.exercise_definition_ids.length} exercise${item.exercise_definition_ids.length === 1 ? '' : 's'}`
      : 'Leaderboard changed';
  const metric = item.kind === 'record' ? item.boards[0]?.metric : item.group_exercise.default_metric;
  const details: string[] = [];
  if (item.kind === 'record') {
    details.push(`As logged: ${formatGroupRawPerformance(item.performance)}`);
    if (item.voided) details.push('This performance no longer counts. Its original event remains in history.');
    else if (item.provisional) details.push('Session in progress');
  } else if (item.kind === 'record_voided') {
    details.push(`The set was ${item.reason === 'deleted' ? 'deleted' : 'corrected'}. Its original record no longer counts.`);
    details.push(...item.leaders.map(entry => `${GROUP_METRIC_LABELS[entry.metric]} · ${entry.leader
      ? `${formatMemberName(entry.leader.member.username)} leads with ${formatGroupMetricValue(entry.leader)}` : 'no current leader'}`));
  } else if (item.kind === 'link') {
    details.push('The comparison changed after linking. This is not a newly performed set.');
    details.push(...item.effects.map(effect => `${GROUP_METRIC_LABELS[effect.metric]}: ${effect.before ? formatGroupMetricValue(effect.before) : 'not ranked'} → ${effect.after ? formatGroupMetricValue(effect.after) : 'not ranked'}`));
  } else if (item.kind === 'rules_change') {
    details.push(`Rules ${item.previous_revision} → ${item.rules_revision}. The whole board was recalculated; this is not a newly performed record.`);
    details.push(describeGroupRules({ ...item.group_exercise, ...item.rules }));
  }
  const metrics = item.kind === 'record' ? item.boards.map(board => {
    const current = item.record_context?.metrics.find(entry => entry.metric === board.metric);
    const certification = current?.certification;
    const active = certification?.ended_at_ms === null ? certification : null;
    const status = item.voided ? 'voided' : active ? 'certified' : 'uncertified';
    const statusLabel = item.voided ? 'Record removed' : active
      ? `Certified by ${active.certified_by?.user_id === userId ? 'you' : active.certified_by?.username ?? 'a group member'}`
      : current ? 'Uncertified' : 'Refresh to check certification';
    return { ...board, status, statusLabel } as const;
  }) : [];
  const accessibilityLabel = [showGroupName ? item.group.name : null, label, context,
    ...metrics.map(board => `${GROUP_METRIC_LABELS[board.metric]} ${formatGroupMetricValue(board)}, ${board.statusLabel}`),
    ...details, formatBoardDate(item.sort_at_ms), item.kind === 'record' ? pressHint : null].filter(Boolean).join(', ');
  const open = onPress ?? (() => router.push(`/group/${item.group.group_id}/leaderboards/${item.group_exercise_id}/history?metric=${metric}&scope=all&revision=${item.rules_revision}`));
  const testID = `group-metric-stream-${item.key}`;
  const footer = `${formatBoardDate(item.sort_at_ms)} · ${pressHint ?? (onPress ? 'View record' : 'View rules history')}`;
  if (item.kind !== 'record') return <Pressable accessibilityLabel={accessibilityLabel}
    accessibilityHint={pressHint ?? 'Opens this rules revision in history'} accessibilityRole="link" onPress={open}
    style={styles.event} testID={testID}>
    {showGroupName ? <Text allowFontScaling={false} style={styles.muted}>{item.group.name}</Text> : null}
    <Text allowFontScaling={false} style={styles.muted}>{label} · {context}</Text>
    {details.map((detail, index) => <Text allowFontScaling={false} key={index} style={styles.muted}>{detail}</Text>)}
    <Text allowFontScaling={false} style={styles.muted}>{footer}</Text>
  </Pressable>;

  const faint = item.voided ? styles.faint : null;
  return <Card accessibilityLabel={accessibilityLabel} testID={testID} style={styles.card} onPress={open}>
    {item.voided ? null : <View style={styles.band}>
      <Icon color={uiRoles.record} name="arrow-up" size="xs" />
      <Text allowFontScaling={false} style={styles.bandTitle}>{label}</Text>
    </View>}
    <View style={styles.body}>
      {item.voided ? <GroupCertificationStatus status="voided" label="Record removed" /> : null}
      <Text allowFontScaling={false} style={[styles.exercise, faint]}>{context}</Text>
      {metrics.map(board => <View key={board.metric} style={styles.metric}>
        <Text allowFontScaling={false} style={[styles.muted, faint]}>{GROUP_METRIC_LABELS[board.metric]}</Text>
        <Text allowFontScaling={false} style={[styles.value, faint]}>{formatGroupMetricValue(board)}</Text>
        {!item.voided ? <GroupCertificationStatus status={board.status} label={board.statusLabel} /> : null}
      </View>)}
      <View style={styles.tags}>{metrics.map(board => <Tag key={board.metric} tone={item.voided ? 'faint' : 'neutral'}
        label={`${GROUP_METRIC_LABELS[board.metric]}${board.group_record ? ' · group record' : ''}`} />)}</View>
      {details.map((detail, index) => <Text allowFontScaling={false} key={index} style={[styles.muted, faint]}>{detail}</Text>)}
      {showGroupName ? <Text allowFontScaling={false} style={[styles.muted, faint]}>{item.group.name}</Text> : null}
      <Text allowFontScaling={false} style={[styles.muted, faint]}>{footer}</Text>
    </View>
  </Card>;
}

const styles = StyleSheet.create({
  card: { marginLeft: uiSpace.md },
  band: {
    flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md, paddingVertical: uiSpace.xs,
    backgroundColor: uiRoles.recordWash, borderBottomWidth: uiBorder.width, borderBottomColor: uiRoles.recordRule,
  },
  bandTitle: {
    flex: 1, fontFamily: uiFonts.display.family, fontWeight: '700',
    fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm, color: uiRoles.record,
  },
  body: { paddingHorizontal: uiSpace.md, paddingVertical: uiSpace.sm, gap: uiSpace.xs },
  exercise: {
    fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink,
  },
  metric: { gap: uiSpace.xs, paddingVertical: uiSpace.xs },
  value: {
    fontFamily: uiFonts.figure.family, fontWeight: '700', fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg, color: uiRoles.record,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: uiSpace.xs },
  muted: {
    fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm, color: uiRoles.inkMuted,
  },
  faint: { color: uiRoles.inkFaint },
  event: { borderTopWidth: uiBorder.width, borderTopColor: uiRoles.rule, paddingVertical: uiSpace.sm, gap: uiSpace.xs },
});
