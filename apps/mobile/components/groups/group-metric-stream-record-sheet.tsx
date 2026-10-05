import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, ScrollView, Text } from 'react-native';
import { ActionButton, ListRow, SegmentedControl, Sheet, uiSpace } from '@/components/ui';
import { useNetworkOnline, type GroupRole } from '@/src/groups';
import { COMPETITION_LABELS, describeCompetitionRules, formatCompetitionHistoricalValue } from '@/src/groups/competition-view-model';
import type { CompetitionMetric } from '@/src/groups/competition-contract';
import type { CompetitionEventWire } from '@/src/groups/competition-wire';
import { buildMetricRecordSheetModel, metricCertificationEndConfirmation, type MetricCertificationEndAction,
  type MetricCertificationTarget } from '@/src/groups/metric-record-sheet-view-model';
import { useMetricCertification } from '@/src/groups/use-metric-certification';
import { GroupWriteNotice } from './write-notice';
import { groupMetricTextStyles as styles } from './screen-styles';

export type MetricStreamRecord = CompetitionEventWire;
type Props = { record: MetricStreamRecord; userId: string; myRole: GroupRole | null; onClose: () => void; onChanged: () => Promise<void> };

export function GroupMetricStreamRecordSheet(props: Props) {
  const { record,onClose } = props;
  const context = record.record_context;
  const [metric,setMetric] = useState<CompetitionMetric>(context?.exercise.rules.default_metric ?? 'e1rm');
  const detail = context?.metrics.find(item => item.metric === metric);
  if (!context || !detail || !record.member || !record.set_id) return <Sheet visible title={record.group_exercise.name}
    dismissLabel="Close record details" onDismiss={onClose} testID="group-metric-record-sheet">
    <Text allowFontScaling={false} style={styles.muted}>Score unavailable. Refresh the stream to review this record.</Text>
  </Sheet>;
  return <CurrentRecordDetails {...props} metric={metric} onSelectMetric={setMetric}
    context={context} detail={detail} member={record.member} setId={record.set_id} />;
}

type Context = NonNullable<CompetitionEventWire['record_context']>;
type CurrentProps = Props & { metric: CompetitionMetric; onSelectMetric: (metric: CompetitionMetric) => void;
  context: Context; detail: Context['metrics'][number]; member: NonNullable<CompetitionEventWire['member']>; setId: string };

function CurrentRecordDetails({ record,userId,myRole,onClose,onChanged,metric,onSelectMetric,context,detail,member,setId }: CurrentProps) {
  const router = useRouter();
  const online = useNetworkOnline();
  const exercise = context.exercise;
  const row: MetricCertificationTarget = { metric,member,former: context.former,write_token: detail.write_token,
    certification: detail.certification,performance: { set_id: setId } };
  const readOnlyReason = record.voided ? 'Certification ended' : !detail.eligible ? 'Score unavailable' : undefined;
  const state = useMetricCertification({ groupId: record.group.group_id,userId,row,exercise,online,readOnlyReason,onChanged });
  const model = buildMetricRecordSheetModel({ ...state,row,exercise,userId,myRole,online,readOnlyReason });
  const guard = { blocked: model.blocked,active: model.active };
  const end = (action: MetricCertificationEndAction) => {
    const confirmation = metricCertificationEndConfirmation(action);
    Alert.alert(confirmation.title,confirmation.message,[{ text: 'Keep',style: 'cancel' },
      { text: confirmation.confirmLabel,style: 'destructive',onPress: () => void state.perform(action,guard) }]);
  };
  const value = record.values.find(value => value.metric === metric && value.role === 'record');
  return <Sheet visible title={`${exercise.name} · ${COMPETITION_LABELS[metric]}`} dismissLabel="Close record details"
    onDismiss={onClose} testID="group-metric-record-sheet">
    <ScrollView contentContainerStyle={{ padding: uiSpace.lg,gap: uiSpace.md }}>
      <SegmentedControl accessibilityLabel="Record metric" value={metric} onChange={onSelectMetric}
        options={context.metrics.map(item => ({ value: item.metric,label: COMPETITION_LABELS[item.metric] }))}
        testIDPrefix="group-metric-record-metric" />
      <Text allowFontScaling={false} style={styles.body}>{record.voided || !value ? 'Score unavailable' : formatCompetitionHistoricalValue(value)}</Text>
      <Text allowFontScaling={false} style={styles.muted}>Recorded under rules {record.rules_revision}. Historical values retain their original units.</Text>
      <Text allowFontScaling={false} style={styles.body}>{record.reps === null ? 'Performance unavailable' : `As logged: ${record.reps} reps`}</Text>
      <Text allowFontScaling={false} style={styles.muted}>{describeCompetitionRules(exercise)}</Text>
      <Text allowFontScaling={false} style={styles.muted}>Certification attests the logged performance under the current group standard. Rule changes preserve it; corrections can invalidate it.</Text>
      <Text allowFontScaling={false} style={styles.body} testID="group-metric-record-status">{model.statusText}</Text>
      {[model.observedRulesNote,model.readOnlyNote,model.offlineNote,model.ownPerformanceNote].filter(Boolean)
        .map(note => <Text allowFontScaling={false} key={note} style={styles.muted}>{note}</Text>)}
      {state.notice ? <GroupWriteNotice {...state.notice} testID="group-metric-record-notice" /> : null}
      {model.showRefresh ? <ActionButton variant="outline" label="Refresh and review" onPress={state.refresh} disabled={state.pending || online === false} /> : null}
      {model.canCertify ? <ActionButton variant="primary" label={`Certify ${COMPETITION_LABELS[metric]}`} disabled={model.blocked}
        onPress={() => void state.perform('certify',guard)} testID="group-metric-record-certify" /> : null}
      {model.canWithdraw ? <ListRow label="Withdraw certification" disabled={model.blocked} onPress={() => end('withdraw')}
        tone="danger" testID="group-metric-record-withdraw" /> : null}
      {model.canCancel ? <ListRow label="Cancel certification" disabled={model.blocked} onPress={() => end('cancel')}
        tone="danger" testID="group-metric-record-cancel" /> : null}
      <ListRow label="View rules history" onPress={() => { onClose(); router.push(`/group/${record.group.group_id}/leaderboards/${record.group_exercise.group_exercise_id}/history?metric=${metric}&scope=all&revision=${record.rules_revision}`); }} />
      {record.session_id ? <ListRow label="View full session" testID="group-metric-record-session" onPress={() => {
        onClose(); router.push(`/group-session/${member.user_id}/${record.session_id}?groupId=${encodeURIComponent(record.group.group_id)}`);
      }} /> : null}
    </ScrollView>
  </Sheet>;
}
