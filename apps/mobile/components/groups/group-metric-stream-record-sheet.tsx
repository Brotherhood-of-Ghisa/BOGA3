import { useRouter, type Href } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon, ListRow, Sheet, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { groupBoardPath, useNetworkOnline, type GroupRole } from '@/src/groups';
import { isCompetitionMetric } from '@/src/groups/competition-contract';
import { buildStreamRecordSheet } from '@/src/groups/competition-stream-view-model';
import type { CompetitionEventWire, CompetitionStreamRecordWire } from '@/src/groups/competition-wire';
import { GroupSetCertification } from './set-certification';

export type MetricStreamRecord = CompetitionEventWire;
type Props = {
  record: MetricStreamRecord; detail?: CompetitionStreamRecordWire; userId: string; myRole: GroupRole | null;
  onClose: () => void; onChanged: () => Promise<void>;
};

/**
 * A stream record: the new record (who, when, the set with its one
 * certification, each value), the group's previous #1 on each board it took,
 * then links to the session and the leaderboard. No explanatory text.
 */
export function GroupMetricStreamRecordSheet({ record, detail, userId, myRole, onClose, onChanged }: Props) {
  const router = useRouter();
  const online = useNetworkOnline();
  const model = buildStreamRecordSheet(record, detail, userId);
  const go = (href: string) => { onClose(); router.push(href as Href); };
  const boardMetric = model.metrics.map(entry => entry.metric).find(isCompetitionMetric);
  return <Sheet visible title={record.group_exercise.name} dismissLabel="Close record details" onDismiss={onClose} testID="group-metric-record-sheet">
    <ScrollView contentContainerStyle={styles.content}>
      <Text allowFontScaling={false} style={styles.eyebrow}>New record</Text>
      <Text allowFontScaling={false} style={styles.who} testID="group-metric-record-who">{model.who}</Text>
      <View style={styles.setLine}>
        {model.set ? <Text allowFontScaling={false} style={styles.set} testID="group-metric-record-set">{model.set}</Text> : null}
        {model.certification ? <GroupSetCertification align="end" certification={model.certification}
          groupId={record.group.group_id} myRole={myRole} onChanged={onChanged} online={online} testID="group-metric-record"
          readOnlyReason={model.certification.eligible ? undefined : 'Score unavailable'} userId={userId} /> : null}
      </View>
      {model.metrics.map(entry => <View key={entry.metric} style={styles.valueLine} testID={`group-metric-record-${entry.metric}`}>
        <Text allowFontScaling={false} style={styles.metricLabel}>{entry.label}</Text>
        <Text allowFontScaling={false} style={styles.value} testID={`group-metric-record-${entry.metric}-value`}>{entry.value}</Text>
      </View>)}
      {model.previous.length > 0 ? <View style={styles.previous} testID="group-metric-record-previous">
        <Text allowFontScaling={false} style={styles.previousEyebrow}>Previous #1</Text>
        {model.previous.map(entry => <View key={entry.metric} style={styles.previousRow} testID={`group-metric-record-previous-${entry.metric}`}>
          <View style={styles.valueLine}>
            <Text allowFontScaling={false} style={styles.metricLabel}>{entry.label}</Text>
            <Text allowFontScaling={false} style={styles.previousValue}>{entry.value}</Text>
          </View>
          <Text allowFontScaling={false} style={styles.previousHolder}>{[entry.holder, entry.set].filter(Boolean).join(' · ')}</Text>
        </View>)}
      </View> : null}
      <View style={styles.links}>
        {record.session_id && record.member ? <ListRow label="Session" testID="group-metric-record-session"
          trailing={<Icon color={uiRoles.inkMuted} name="chevron-right" />}
          onPress={() => go(`/group-session/${record.member!.user_id}/${record.session_id}?groupId=${encodeURIComponent(record.group.group_id)}`)} /> : null}
        <ListRow label="Leaderboard" testID="group-metric-record-board" trailing={<Icon color={uiRoles.inkMuted} name="chevron-right" />}
          onPress={() => go(groupBoardPath(record.group.group_id, record.group_exercise.group_exercise_id,
            boardMetric ? { metric: boardMetric, scope: 'all' } : undefined))} />
      </View>
    </ScrollView>
  </Sheet>;
}

const microLabel = {
  fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, lineHeight: uiTypography.lineHeight.xxs,
  letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking, textTransform: 'uppercase',
} as const;
const styles = StyleSheet.create({
  content: { padding: uiSpace.lg, gap: uiSpace.sm },
  eyebrow: { ...microLabel, color: uiRoles.record },
  previousEyebrow: { ...microLabel, color: uiRoles.inkMuted },
  who: { fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink },
  setLine: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
  set: { flexShrink: 1, fontFamily: uiFonts.figure.family, fontWeight: '600', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink },
  valueLine: { flexDirection: 'row', alignItems: 'baseline', gap: uiSpace.sm },
  metricLabel: { flex: 1, fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink },
  value: { fontFamily: uiFonts.figure.family, fontWeight: '700', fontSize: uiTypography.size.lg, lineHeight: uiTypography.lineHeight.lg, color: uiRoles.record },
  previous: { marginTop: uiSpace.sm, paddingTop: uiSpace.sm, gap: uiSpace.sm, borderTopWidth: uiBorder.width, borderTopColor: uiRoles.ruleSoft },
  previousRow: { gap: uiSpace.xs },
  previousValue: { fontFamily: uiFonts.figure.family, fontWeight: '600', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink },
  previousHolder: { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm, color: uiRoles.inkMuted },
  links: { marginTop: uiSpace.sm },
});
