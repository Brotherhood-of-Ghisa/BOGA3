import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Icon, Tag, uiBorder, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { formatGroupMetricValue, GROUP_METRIC_LABELS } from '@/src/groups/metric-view-model';
import type { GroupMetricStreamItemWire } from '@/src/groups/metric-wire';
import {
  buildMetricStreamCardModel,
  type MetricStreamBoardView,
  type MetricStreamCardModel,
} from '@/src/groups/metric-stream-view-model';
import { GroupCertificationStatus } from './certification-status';

/** Event values belong to their recorded rules; opening history preserves that revision. */
export function GroupMetricStreamCard({ item, userId, showGroupName, onPress, pressHint }: {
  onPress?: () => void; pressHint?: string;
  item: GroupMetricStreamItemWire; userId: string | null; showGroupName: boolean;
}) {
  const router = useRouter();
  const model = buildMetricStreamCardModel(item, userId, { showGroupName, pressHint, hasOnPress: onPress !== undefined });
  const open = onPress ?? (() => router.push(model.historyPath));
  const testID = `group-metric-stream-${item.key}`;
  return model.isRecord
    ? <MetricStreamRecordCard model={model} onPress={open} testID={testID} />
    : <MetricStreamEventRow accessibilityHint={pressHint ?? 'Opens this rules revision in history'} model={model}
      onPress={open} testID={testID} />;
}

type CardViewProps = { model: MetricStreamCardModel; onPress: () => void; testID: string };

/** Everything but a performed record: a compact row. */
function MetricStreamEventRow({ model, onPress, testID, accessibilityHint }: CardViewProps & { accessibilityHint: string }) {
  return <Pressable accessibilityLabel={model.accessibilityLabel} accessibilityHint={accessibilityHint}
    accessibilityRole="link" onPress={onPress} style={styles.event} testID={testID}>
    {model.groupName ? <Text allowFontScaling={false} style={styles.muted}>{model.groupName}</Text> : null}
    <Text allowFontScaling={false} style={styles.muted}>{model.label} · {model.context}</Text>
    {model.details.map((detail, index) => <Text allowFontScaling={false} key={index} style={styles.muted}>{detail}</Text>)}
    <Text allowFontScaling={false} style={styles.muted}>{model.footer}</Text>
  </Pressable>;
}

/** A performed record: the record band, each board's value and certification, and its tags. */
function MetricStreamRecordCard({ model, onPress, testID }: CardViewProps) {
  const faint = model.voided ? styles.faint : null;
  return <Card accessibilityLabel={model.accessibilityLabel} testID={testID} style={styles.card} onPress={onPress}>
    {model.voided ? null : <View style={styles.band}>
      <Icon color={uiRoles.record} name="arrow-up" size="xs" />
      <Text allowFontScaling={false} style={styles.bandTitle}>{model.label}</Text>
    </View>}
    <View style={styles.body}>
      {model.voided ? <GroupCertificationStatus status="voided" label="Record removed" /> : null}
      <Text allowFontScaling={false} style={[styles.exercise, faint]}>{model.context}</Text>
      {model.boards.map(board => <RecordBoardLine board={board} key={board.metric} voided={model.voided} />)}
      <View style={styles.tags}>{model.boards.map(board => <Tag key={board.metric} tone={model.voided ? 'faint' : 'neutral'}
        label={`${GROUP_METRIC_LABELS[board.metric]}${board.group_record ? ' · group record' : ''}`} />)}</View>
      {model.details.map((detail, index) => <Text allowFontScaling={false} key={index} style={[styles.muted, faint]}>{detail}</Text>)}
      {model.groupName ? <Text allowFontScaling={false} style={[styles.muted, faint]}>{model.groupName}</Text> : null}
      <Text allowFontScaling={false} style={[styles.muted, faint]}>{model.footer}</Text>
    </View>
  </Card>;
}

function RecordBoardLine({ board, voided }: { board: MetricStreamBoardView; voided: boolean }) {
  const faint = voided ? styles.faint : null;
  return <View style={styles.metric}>
    <Text allowFontScaling={false} style={[styles.muted, faint]}>{GROUP_METRIC_LABELS[board.metric]}</Text>
    <Text allowFontScaling={false} style={[styles.value, faint]}>{formatGroupMetricValue(board)}</Text>
    {voided ? null : <GroupCertificationStatus status={board.status} label={board.statusLabel} />}
  </View>;
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
