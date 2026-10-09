// The Timeline's week list ([[comparison.timeline-history]]): one
// `ExerciseSetsCard` per block from `week-sets.ts`. A card opens its session.
import { StyleSheet, Text, View } from 'react-native';

import { ExerciseSetsCard } from '@/components/session-detail';
import { StatePanel, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';

import type { WeekSetsState } from './week-sets';

type Props = WeekSetsState & {
  onOpenSession: (sessionId: string) => void;
  onRetry?: () => void;
  testID: string;
};

export function WeekSetList({ groups, loading, error, onOpenSession, onRetry, testID }: Props) {
  if (error) {
    return <StatePanel action={onRetry ? { label: 'Retry', onPress: onRetry, testID: `${testID}-retry` } : undefined}
      body={error} fill={false} kind="error" testID={`${testID}-error`} title="Could not load this week's sets" />;
  }
  if (loading) return <StatePanel body="Loading sets..." fill={false} kind="loading" testID={`${testID}-loading`} />;
  if (groups.length === 0) {
    return <Text allowFontScaling={false} style={styles.empty} testID={`${testID}-empty`}>No sets this week</Text>;
  }
  return <View style={styles.list} testID={testID}>
    {groups.map((group) => <ExerciseSetsCard key={group.key}
      accessibilityLabel={`Open session from ${group.detail === group.title ? group.title : `${group.title}, ${group.detail}`}`}
      count={`${group.workingSetCount} ${group.workingSetCount === 1 ? 'set' : 'sets'}`}
      name={group.title} onPress={() => onOpenSession(group.sessionId)} rows={group.rows} record={group.record}
      summary={<View style={styles.summary}>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.detail}>{group.detail}</Text>
      </View>}
      testID={`${testID}-card-${group.key}`} />)}
  </View>;
}

const styles = StyleSheet.create({
  list: { gap: uiSpace.md },
  // As Exercise History's session cards.
  summary: { paddingHorizontal: uiSpace.md, paddingBottom: uiSpace.sm },
  detail: { fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm, color: uiRoles.inkMuted },
  empty: { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm, color: uiRoles.inkMuted },
});
