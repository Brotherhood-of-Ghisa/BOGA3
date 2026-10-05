import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Card, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { buildCompetitionEventCard } from '@/src/groups/competition-stream-view-model';
import type { CompetitionEventWire } from '@/src/groups/competition-wire';

/** Original event units remain visible; private invalidation causes never enter copy. */
export function GroupMetricStreamCard({ item,userId,showGroupName,onPress,pressHint }: {
  item: CompetitionEventWire; userId: string | null; showGroupName: boolean;
  onPress?: () => void; pressHint?: string;
}) {
  const router = useRouter();
  const model = buildCompetitionEventCard(item,userId,showGroupName);
  return <Card accessibilityLabel={model.accessibilityLabel} onPress={onPress ?? (() => router.push(model.historyPath))}
    style={styles.card} testID={`group-metric-stream-${item.event_id}`}>
    {model.groupName ? <Text allowFontScaling={false} style={styles.muted}>{model.groupName}</Text> : null}
    <Text allowFontScaling={false} style={styles.label}>{model.label}</Text>
    <Text allowFontScaling={false} style={styles.context}>{model.context}</Text>
    {model.details.map((detail,index) => <Text allowFontScaling={false} key={index} style={styles.figure}>{detail}</Text>)}
    <View><Text allowFontScaling={false} style={styles.muted}>{model.date} · {pressHint ?? 'View rules history'}</Text></View>
  </Card>;
}
const styles = StyleSheet.create({
  card: { padding: uiSpace.md,gap: uiSpace.xs },
  label: { fontFamily: uiFonts.display.family,fontSize: uiTypography.size.sm,color: uiRoles.record },
  context: { fontFamily: uiFonts.display.family,fontSize: uiTypography.size.base,color: uiRoles.ink },
  figure: { fontFamily: uiFonts.figure.family,fontSize: uiTypography.size.base,color: uiRoles.ink },
  muted: { fontFamily: uiFonts.body.family,fontSize: uiTypography.size.sm,color: uiRoles.inkMuted },
});
