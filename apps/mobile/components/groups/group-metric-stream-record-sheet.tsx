import { useDateFormat } from '@/src/preferences/hooks';
import { useRouter, type Href } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FigureText, Icon, ListRow, Sheet, uiBorder, uiRoles, uiSpace, uiText, uiTextTone } from '@/components/ui';
import { groupBoardPath, useNetworkOnline, type GroupRole } from '@/src/groups';
import { isCompetitionMetric } from '@/src/groups/competition-contract';
import { buildStreamRecordSheet } from '@/src/groups/competition-stream-view-model';
import type { CompetitionEventWire, CompetitionStreamRecordWire } from '@/src/groups/competition-wire';
import { scoreHasFigure, scoreStyle } from './score-style';
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
  const dateFormat = useDateFormat();
  const router = useRouter();
  const online = useNetworkOnline();
  const model = buildStreamRecordSheet(record, detail, userId, dateFormat);
  const go = (href: string) => { onClose(); router.push(href as Href); };
  const boardMetric = model.metrics.map(entry => entry.metric).find(isCompetitionMetric);
  return <Sheet visible title={record.group_exercise.name} dismissLabel="Close record details" onDismiss={onClose} testID="group-metric-record-sheet">
    <ScrollView contentContainerStyle={styles.content}>
      <Text allowFontScaling={false} style={[uiText.label, uiTextTone.record]}>New record</Text>
      <Text allowFontScaling={false} style={uiText.bodyStrong} testID="group-metric-record-who"><FigureText strong>{model.who}</FigureText></Text>
      <View style={styles.setLine}>
        {model.set ? <Text allowFontScaling={false} style={[uiText.body, styles.set]} testID="group-metric-record-set"><FigureText>{model.set}</FigureText></Text> : null}
        {model.certification ? <GroupSetCertification align="end" certification={model.certification}
          groupId={record.group.group_id} myRole={myRole} onChanged={onChanged} online={online} testID="group-metric-record"
          readOnlyReason={model.certification.eligible ? undefined : 'Score unavailable'} userId={userId} /> : null}
      </View>
      {model.metrics.map(entry => <View key={entry.metric} style={styles.valueLine} testID={`group-metric-record-${entry.metric}`}>
        <Text allowFontScaling={false} style={[uiText.bodyStrong, styles.metricLabel]}>{entry.label}</Text>
        <Text allowFontScaling={false} style={[scoreStyle(entry.value, 'large'), scoreHasFigure(entry.value) ? uiTextTone.record : null]} testID={`group-metric-record-${entry.metric}-value`}>{entry.value}</Text>
      </View>)}
      {model.previous.length > 0 ? <View style={styles.previous} testID="group-metric-record-previous">
        <Text allowFontScaling={false} style={uiText.label}>Previous #1</Text>
        {model.previous.map(entry => <View key={entry.metric} style={styles.previousRow} testID={`group-metric-record-previous-${entry.metric}`}>
          <View style={styles.valueLine}>
            <Text allowFontScaling={false} style={[uiText.bodyStrong, styles.metricLabel]}>{entry.label}</Text>
            <Text allowFontScaling={false} style={scoreStyle(entry.value, 'base')}>{entry.value}</Text>
          </View>
          <Text allowFontScaling={false} style={uiText.meta}><FigureText>{[entry.holder, entry.set].filter(Boolean).join(' · ')}</FigureText></Text>
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

const styles = StyleSheet.create({
  content: { padding: uiSpace.lg, gap: uiSpace.sm },
  setLine: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
  set: { flexShrink: 1 },
  valueLine: { flexDirection: 'row', alignItems: 'baseline', gap: uiSpace.sm },
  metricLabel: { flex: 1 },
  previous: { marginTop: uiSpace.sm, paddingTop: uiSpace.sm, gap: uiSpace.sm, borderTopWidth: uiBorder.width, borderTopColor: uiRoles.ruleSoft },
  previousRow: { gap: uiSpace.xs },
  links: { marginTop: uiSpace.sm },
});
