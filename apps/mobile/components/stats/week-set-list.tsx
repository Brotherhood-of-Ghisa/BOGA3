// The Timeline's week list: one `ExerciseSetsCard` per block from
// `week-sets.ts`, newest first. A card's header carries its title and detail
// (a muscle's exercise and day, an exercise's day and gym). A card opens its
// session; on a muscle's list, its header also marks the block's primary or
// secondary work, and its progress button opens its exercise's history.
import { StyleSheet, Text, View } from 'react-native';

import { ExerciseSetsCard } from '@/components/session-detail';
import { useDelayedFlag } from '@/components/stats/use-delayed-flag';
import { Icon, IconButton, StatePanel, uiGeometry, uiRoles, uiSpace, uiText, uiTypography } from '@/components/ui';

import type { WeekBlockRole, WeekSetGroup, WeekSetsState } from './week-sets';

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

// A week read that lands within this never draws its loading panel.
export const WEEK_SETS_LOADING_DELAY_MS = 250;

const ROLE_LABELS: Record<WeekBlockRole, string> = { primary: 'Primary', secondary: 'Secondary' };

export function WeekSetList({ groups, loading, error, onOpenSession, exerciseLink, onRetry, testID }: Props) {
  const showLoading = useDelayedFlag(loading, WEEK_SETS_LOADING_DELAY_MS);
  if (error) {
    return <StatePanel action={onRetry ? { label: 'Retry', onPress: onRetry, testID: `${testID}-retry` } : undefined}
      body={error} fill={false} kind="error" testID={`${testID}-error`} title="Could not load this week's sets" />;
  }
  // While the next week loads, the last one's cards stay until it lands.
  if (loading && groups.length === 0) {
    return showLoading ? <StatePanel body="Loading sets..." fill={false} kind="loading" testID={`${testID}-loading`} /> : null;
  }
  if (groups.length === 0) {
    return <Text allowFontScaling={false} style={uiText.meta} testID={`${testID}-empty`}>No sets this week</Text>;
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
  const described = [group.title, group.detail === group.title ? null : group.detail, group.role ? ROLE_LABELS[group.role] : null]
    .filter(Boolean).join(', ');
  const roleMark = group.role ? <Icon color={uiRoles.inkMuted}
    name={`role-${group.role}`} size="xs" testID={`${testID}-role-${group.role}`} /> : null;
  return <ExerciseSetsCard
    accessibilityLabel={`Open session from ${described}`}
    // The card reads as one element, so VoiceOver reaches the button as its action.
    accessibilityActions={openExercise ? [{ name: OPEN_EXERCISE_ACTION, label: exerciseLabel }] : undefined}
    onAccessibilityAction={openExercise
      ? (event) => { if (event.nativeEvent.actionName === OPEN_EXERCISE_ACTION) openExercise(); }
      : undefined}
    accessory={roleMark || openExercise ? <>
      {roleMark}
      {openExercise ? <View style={styles.exerciseButton}>
        <IconButton accessibilityLabel={exerciseLabel} name="progress" onPress={openExercise} size="sm" tone="muted"
          testID={`${testID}-exercise`} />
      </View> : null}
    </> : undefined}
    count={group.detail}
    name={group.title} onPress={() => onOpenSession(group.sessionId)} rows={group.rows} record={group.record}
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
});
