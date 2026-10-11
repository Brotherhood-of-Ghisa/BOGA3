import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Card, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { buildCompetitionEventCard } from '@/src/groups/competition-stream-view-model';
import type { CompetitionEventWire, CompetitionStreamRecordWire } from '@/src/groups/competition-wire';
import { GroupCertificationStatus } from './certification-status';

/**
 * A competition stream card. A record shows its set on its own line with the
 * set's one certification beside it, then the record values. Original event
 * units remain visible; private invalidation causes never enter copy.
 */
export function GroupMetricStreamCard({ item,record,userId,showGroupName,onPress }: {
  item: CompetitionEventWire; record?: CompetitionStreamRecordWire; userId: string | null; showGroupName: boolean; onPress?: () => void;
}) {
  const router = useRouter();
  const model = buildCompetitionEventCard(item,userId,showGroupName,record);
  const testID = `group-metric-stream-${item.event_id}`;
  return <Card accessibilityLabel={model.accessibilityLabel} onPress={onPress ?? (() => router.push(model.historyPath))}
    style={styles.card} testID={testID}>
    {model.groupName ? <Text allowFontScaling={false} style={styles.muted}>{model.groupName}</Text> : null}
    <Text allowFontScaling={false} style={styles.label}>{model.label}</Text>
    <Text allowFontScaling={false} style={styles.context}>{model.context}</Text>
    {model.set || model.certification ? <View style={styles.setLine}>
      <Text allowFontScaling={false} style={[styles.figure,styles.set]} testID={`${testID}-set`}>{model.set ?? ''}</Text>
      {model.certification ? <GroupCertificationStatus label={model.certification.label} size="meta"
        status={model.certification.status} testID={`${testID}-certification`} /> : null}
    </View> : null}
    {model.details.map((detail,index) => <Text allowFontScaling={false} key={index} style={styles.figure}>{detail}</Text>)}
    <Text allowFontScaling={false} style={styles.muted}>{model.date}</Text>
  </Card>;
}
const styles = StyleSheet.create({
  card: { padding: uiSpace.md,gap: uiSpace.xs },
  label: { fontFamily: uiFonts.display.family,fontSize: uiTypography.size.sm,color: uiRoles.record },
  context: { fontFamily: uiFonts.display.family,fontSize: uiTypography.size.base,color: uiRoles.ink },
  setLine: { flexDirection: 'row',alignItems: 'center',justifyContent: 'space-between',gap: uiSpace.sm },
  set: { flexShrink: 1 },
  figure: { fontFamily: uiFonts.figure.family,fontSize: uiTypography.size.base,color: uiRoles.ink },
  muted: { fontFamily: uiFonts.body.family,fontSize: uiTypography.size.sm,color: uiRoles.inkMuted },
});
