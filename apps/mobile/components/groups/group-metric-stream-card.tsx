import { useDateFormat } from '@/src/preferences/hooks';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Card, FigureText, uiSpace, uiText, uiTextTone } from '@/components/ui';
import { buildCompetitionEventCard } from '@/src/groups/competition-stream-view-model';
import type { CompetitionEventWire, CompetitionStreamRecordWire } from '@/src/groups/competition-wire';
import { GroupCertificationStatus } from './certification-status';
import { scoreHasFigure } from './score-style';

/**
 * A competition stream card. A record shows its set on its own line with the
 * set's one certification beside it, then the record values. Original event
 * units remain visible; private invalidation causes never enter copy.
 */
export function GroupMetricStreamCard({ item,record,userId,showGroupName,onPress }: {
  item: CompetitionEventWire; record?: CompetitionStreamRecordWire; userId: string | null; showGroupName: boolean; onPress?: () => void;
}) {
  const dateFormat = useDateFormat();
  const router = useRouter();
  const model = buildCompetitionEventCard(item,userId,showGroupName,record,dateFormat);
  const testID = `group-metric-stream-${item.event_id}`;
  return <Card accessibilityLabel={model.accessibilityLabel} onPress={onPress ?? (() => router.push(model.historyPath))}
    style={styles.card} testID={testID}>
    {model.groupName ? <Text allowFontScaling={false} style={uiText.meta}>{model.groupName}</Text> : null}
    <Text allowFontScaling={false} style={[uiText.label, uiTextTone.record]} testID={`${testID}-label`}>{model.label}</Text>
    <Text allowFontScaling={false} style={uiText.bodyStrong} testID={`${testID}-context`}>{model.context}</Text>
    {model.set || model.certification ? <View style={styles.setLine}>
      <Text allowFontScaling={false} style={[uiText.body, styles.set]} testID={`${testID}-set`}><FigureText>{model.set ?? ''}</FigureText></Text>
      {model.certification ? <GroupCertificationStatus label={model.certification.label} size="meta"
        status={model.certification.status} testID={`${testID}-certification`} /> : null}
    </View> : null}
    {model.details.map((detail,index) => <Text allowFontScaling={false} key={index} style={[uiText.body, scoreHasFigure(detail) ? null : uiTextTone.muted]}
      testID={`${testID}-detail-${index}`}><FigureText>{detail}</FigureText></Text>)}
    <Text allowFontScaling={false} style={uiText.meta} testID={`${testID}-date`}><FigureText>{model.date}</FigureText></Text>
  </Card>;
}
const styles = StyleSheet.create({
  card: { padding: uiSpace.md,gap: uiSpace.xs },
  setLine: { flexDirection: 'row',alignItems: 'center',justifyContent: 'space-between',gap: uiSpace.sm },
  set: { flexShrink: 1 },
});
