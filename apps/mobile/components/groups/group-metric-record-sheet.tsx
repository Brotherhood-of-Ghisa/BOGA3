import { useRouter } from 'expo-router';
import { Text, Alert, ScrollView } from 'react-native';

import { ActionButton, ListRow, SegmentedControl, Sheet, Stat, uiSpace } from '@/components/ui';
import { formatBoardDate, formatBoardMemberLabel, useNetworkOnline, type GroupRole } from '@/src/groups';
import { describeCompetitionRules as describeGroupRules,formatCompetitionValue as formatGroupMetricValue,formatCompetitionPerformance as formatGroupRawPerformance,COMPETITION_LABELS as GROUP_METRIC_LABELS,COMPETITION_LABELS as GROUP_METRIC_SHORT_LABELS } from '@/src/groups/competition-view-model';
import type { CompetitionMetric as GroupMetric } from '@/src/groups/competition-contract';
import {
  buildMetricRecordSheetModel,
  metricCertificationEndConfirmation,
  type MetricCertificationEndAction,
} from '@/src/groups/metric-record-sheet-view-model';
import type { CompetitionBoardRowWire as GroupMetricBoardRowWire,CompetitionCertificationWire as GroupMetricCertificationWire,CompetitionExerciseWire as GroupMetricExerciseWire } from '@/src/groups/competition-wire';
import { useMetricCertification } from '@/src/groups/use-metric-certification';
import { GroupWriteNotice } from './write-notice';
import { groupMetricTextStyles as textStyles } from './screen-styles';

/** A metric attestation always submits the revision and random write token shown here. */
export function GroupMetricRecordSheet({ row, exercise, groupId, userId, myRole, onClose, onChanged, readOnlyReason, initialCertification, metricOptions, onSelectMetric, onHistory }: {
  row: GroupMetricBoardRowWire; exercise: GroupMetricExerciseWire; groupId: string; userId: string;
  readOnlyReason?: string; initialCertification?: GroupMetricCertificationWire | null;
  metricOptions?: GroupMetric[]; onSelectMetric?: (metric: GroupMetric) => void; onHistory?: () => void;
  myRole: GroupRole | null; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const online = useNetworkOnline();
  const { certification, pending, needsReview, notice, perform, refresh } = useMetricCertification({
    groupId,userId, row, exercise, online, readOnlyReason, initialCertification, onChanged,
  });
  const model = buildMetricRecordSheetModel({
    row, exercise, userId, myRole, certification, readOnlyReason, online, pending, needsReview, notice,
  });
  const guard = { blocked: model.blocked, active: model.active };
  const confirmEnd = (action: MetricCertificationEndAction) => {
    const { title, message, confirmLabel } = metricCertificationEndConfirmation(action);
    Alert.alert(title, message, [{ text: 'Keep', style: 'cancel' },
      { text: confirmLabel, style: 'destructive', onPress: () => void perform(action, guard) }]);
  };

  return <Sheet visible title={`${exercise.name} · ${GROUP_METRIC_LABELS[row.metric]}`} dismissLabel="Close set details"
    onDismiss={onClose} testID="group-metric-record-sheet">
    <ScrollView contentContainerStyle={{ padding: uiSpace.lg, gap: uiSpace.md }}>
      {metricOptions && onSelectMetric ? <SegmentedControl accessibilityLabel="Record metric" value={row.metric}
        options={metricOptions.map(value => ({ value, label: GROUP_METRIC_SHORT_LABELS[value] }))}
        onChange={onSelectMetric} testIDPrefix="group-metric-record-metric" /> : null}
      <Stat emphasis="record" label={GROUP_METRIC_LABELS[row.metric]} value={formatGroupMetricValue(row)} />
      <Text allowFontScaling={false} style={textStyles.body}>{formatBoardMemberLabel(row.member, row.former, userId)} · {formatBoardDate(row.performance.achieved_at_ms)}</Text>
      <Text allowFontScaling={false} style={textStyles.body} testID="group-metric-record-raw">As logged: {formatGroupRawPerformance(row.performance)}</Text>
      <Text allowFontScaling={false} style={textStyles.muted}>{describeGroupRules(exercise)}</Text>
      <Text allowFontScaling={false} style={textStyles.muted}>Certification attests this logged performance. Rule changes preserve it; corrections can invalidate it.</Text>
      <Text allowFontScaling={false} style={textStyles.muted}>{row.metric === 'e1rm' ? 'Strength values are estimates. ' : ''}Scores use the group’s rules, independently of personal exercise settings.</Text>
      <Text allowFontScaling={false} style={textStyles.body} testID="group-metric-record-status">{model.statusText}</Text>
      <MutedLine text={model.observedRulesNote} />
      <MutedLine text={model.readOnlyNote} />
      <MutedLine text={model.offlineNote} />
      <MutedLine text={model.ownPerformanceNote} />
      {notice ? <GroupWriteNotice {...notice} testID="group-metric-record-notice" /> : null}
      {model.showRefresh ? <ActionButton label="Refresh and review" disabled={pending || online === false}
        onPress={refresh} variant="outline" testID="group-metric-record-refresh" /> : null}
      {model.canCertify ? <ActionButton label={`Certify ${GROUP_METRIC_LABELS[row.metric]}`} disabled={model.blocked}
        onPress={() => void perform('certify', guard)} variant="primary" testID="group-metric-record-certify" /> : null}
      {model.canWithdraw ? <ListRow label="Withdraw certification" disabled={model.blocked}
        onPress={() => confirmEnd('withdraw')} tone="danger" testID="group-metric-record-withdraw" /> : null}
      {model.canCancel ? <ListRow label="Cancel certification" disabled={model.blocked}
        onPress={() => confirmEnd('cancel')} tone="danger" testID="group-metric-record-cancel" /> : null}
      {onHistory ? <ListRow label="View rules history" onPress={onHistory} testID="group-metric-record-history" /> : null}
      <ListRow label="View full session" onPress={() => { onClose(); router.push(`/group-session/${row.member.user_id}/${row.performance.session_id}?groupId=${encodeURIComponent(groupId)}`); }}
        testID="group-metric-record-session" />
    </ScrollView>
  </Sheet>;
}

function MutedLine({ text }: { text: string | null }) {
  return text ? <Text allowFontScaling={false} style={textStyles.muted}>{text}</Text> : null;
}
