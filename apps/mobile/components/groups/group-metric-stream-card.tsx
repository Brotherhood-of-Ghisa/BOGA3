import { useDateFormat } from '@/src/preferences/hooks';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { CompactCard, CompactHeader, FigureText, uiSpace, useUiText, useUiTextTone } from '@/components/ui';
import { buildCompetitionEventCard } from '@/src/groups/competition-stream-view-model';
import type { CompetitionEventWire, CompetitionStreamRecordWire, CompetitionStreamWithdrawnWire } from '@/src/groups/competition-wire';
import { GroupCertificationStatus } from './certification-status';
import { scoreHasFigure } from './score-style';

/**
 * A competition stream card. A record shows its set on its own line with the
 * set's one certification beside it, then the record values; a withdrawn
 * record shows the same, labelled withdrawn, without a certification. Original
 * event units remain visible; private invalidation causes never enter copy.
 */
export function GroupMetricStreamCard({ item,record,withdrawn,userId,showGroupName,onPress }: {
  item: CompetitionEventWire; record?: CompetitionStreamRecordWire; withdrawn?: CompetitionStreamWithdrawnWire | null;
  userId: string | null; showGroupName: boolean; onPress?: () => void;
}) {
  const dateFormat = useDateFormat();
  const text = useUiText();
  const tone = useUiTextTone();
  const router = useRouter();
  const model = buildCompetitionEventCard(item,userId,showGroupName,{ record,withdrawn },dateFormat);
  const testID = `group-metric-stream-${item.event_id}`;
  return <CompactCard accessibilityLabel={model.accessibilityLabel} onPress={onPress ?? (() => router.push(model.historyPath))}
    testID={testID}>
    {model.groupName ? <Text allowFontScaling={false} style={text.meta}>{model.groupName}</Text> : null}
    <CompactHeader label={model.label} metadata={model.date} tone="record"
      labelTestID={`${testID}-label`} metadataTestID={`${testID}-date`} />
    <Text allowFontScaling={false} style={text.bodyStrong} testID={`${testID}-context`}>{model.context}</Text>
    {model.set || model.certification ? <View style={styles.setLine}>
      <Text allowFontScaling={false} style={[text.body, styles.set]} testID={`${testID}-set`}><FigureText>{model.set ?? ''}</FigureText></Text>
      {model.certification ? <GroupCertificationStatus label={model.certification.label} size="meta"
        status={model.certification.status} testID={`${testID}-certification`} /> : null}
    </View> : null}
    {model.details.map((detail,index) => <Text allowFontScaling={false} key={index} style={[text.body, scoreHasFigure(detail) ? null : tone.muted]}
      testID={`${testID}-detail-${index}`}><FigureText>{detail}</FigureText></Text>)}
  </CompactCard>;
}
const styles = StyleSheet.create({
  setLine: { flexDirection: 'row',alignItems: 'center',justifyContent: 'space-between',gap: uiSpace.sm },
  set: { flexShrink: 1 },
});
