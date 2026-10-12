// The Timeline's week list: one
// `ExerciseSetsCard` per block from `week-sets.ts`. A card opens its session;
// on a muscle's list, its header's progress button opens its exercise's history.
import { StyleSheet, Text, View } from 'react-native';

import { ExerciseSetsCard } from '@/components/session-detail';
import { IconButton, StatePanel, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';

import type { WeekSetGroup, WeekSetsState } from './week-sets';

/** Where a card's exercise goes: offered only for an exercise the catalogue still holds. */
export type WeekSetExerciseLink = {
  canOpen: (exerciseDefinitionId: string) => boolean;
  open: (exerciseDefinitionId: string) => void;
};

type Props = WeekSetsState & {
  onOpenSession: (sessionId: string) => void;
  exerciseLink?: WeekSetExerciseLink;
  onRetry?: () => void;
  testID: string;
};

const OPEN_EXERCISE_ACTION = 'openExercise';

export function WeekSetList({ groups, loading, error, onOpenSession, exerciseLink, onRetry, testID }: Props) {
  if (error) {
    return <StatePanel action={onRetry ? { label: 'Retry', onPress: onRetry, testID: `${testID}-retry` } : undefined}
      body={error} fill={false} kind="error" testID={`${testID}-error`} title="Could not load this week's sets" />;
  }
  if (loading) return <StatePanel body="Loading sets..." fill={false} kind="loading" testID={`${testID}-loading`} />;
  if (groups.length === 0) {
    return <Text allowFontScaling={false} style={styles.empty} testID={`${testID}-empty`}>No sets this week</Text>;
  }
  return <View style={styles.list} testID={testID}>
    {groups.map((group) => <WeekSetCard key={group.key} exerciseLink={exerciseLink} group={group}
      onOpenSession={onOpenSession} testID={`${testID}-card-${group.key}`} />)}
  </View>;
}

function WeekSetCard({ group, onOpenSession, exerciseLink, testID }: {
  group: WeekSetGroup;
  onOpenSession: (sessionId: string) => void;
  exerciseLink?: WeekSetExerciseLink;
  testID: string;
}) {
  const exerciseId = group.exerciseDefinitionId;
  const openExercise = exerciseLink && exerciseId !== null && exerciseLink.canOpen(exerciseId)
    ? () => exerciseLink.open(exerciseId)
    : null;
  const exerciseLabel = `Open ${group.title} progress`;
  return <ExerciseSetsCard
    accessibilityLabel={`Open session from ${group.detail === group.title ? group.title : `${group.title}, ${group.detail}`}`}
    // The card reads as one element, so VoiceOver reaches the button as its action.
    accessibilityActions={openExercise ? [{ name: OPEN_EXERCISE_ACTION, label: exerciseLabel }] : undefined}
    onAccessibilityAction={openExercise
      ? (event) => { if (event.nativeEvent.actionName === OPEN_EXERCISE_ACTION) openExercise(); }
      : undefined}
    accessory={openExercise ? <View style={styles.exerciseButton}>
      <IconButton accessibilityLabel={exerciseLabel} name="progress" onPress={openExercise} size="sm" tone="muted"
        testID={`${testID}-exercise`} />
    </View> : undefined}
    count={`${group.workingSetCount} ${group.workingSetCount === 1 ? 'set' : 'sets'}`}
    name={group.title} onPress={() => onOpenSession(group.sessionId)} rows={group.rows} record={group.record}
    summary={<View style={styles.summary}>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.detail}>{group.detail}</Text>
    </View>}
    testID={testID} />;
}

const styles = StyleSheet.create({
  list: { gap: uiSpace.md },
  // A 44pt target that leaves the header its text height: it overhangs the
  // name's line and pulls into the card's right inset.
  exerciseButton: {
    marginVertical: -(uiGeometry.tapTarget - uiTypography.lineHeight.lg) / 2,
    marginRight: -uiSpace.sm,
  },
  // As Exercise History's session cards.
  summary: { paddingHorizontal: uiSpace.md, paddingBottom: uiSpace.sm },
  detail: { fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm, color: uiRoles.inkMuted },
  empty: { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm, color: uiRoles.inkMuted },
});
