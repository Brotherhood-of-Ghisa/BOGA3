// The Timeline's week list: one `ExerciseSetsCard` per block from
// `week-sets.ts`, newest first. A card's header carries its title and detail
// (a muscle's exercise and day, an exercise's day and gym). A card opens its
// session; on a muscle's list, its header also marks the block's primary or
// secondary work, and its progress button opens its exercise's history.
import { StyleSheet, Text, View } from 'react-native';

import { ExerciseSetsCard } from '@/components/session-detail';
import { useDelayedFlag } from '@/components/stats/use-delayed-flag';
import { FigureText, Icon, IconButton, StatePanel, uiGeometry, uiSpace, uiTypography } from '@/components/ui';
import { useUiText } from '@/components/ui/text-roles';
import { formatVolume, formatWorkingSetCount } from '@/src/exercise-calculations/format';

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
  contributionMetric?: 'workingSetCount' | 'totalVolume';
  period?: 'day' | 'week';
};

const OPEN_EXERCISE_ACTION = 'openExercise';

// A week read that lands within this never draws its loading panel.
export const WEEK_SETS_LOADING_DELAY_MS = 250;

const ROLE_LABELS: Record<WeekBlockRole, string> = { primary: 'Primary', secondary: 'Secondary' };

const contributionCredit = (group: WeekSetGroup, metric: Props['contributionMetric']): string | null => {
  if (!metric || !group.contribution) return null;
  const { sets, volume } = group.contribution;
  if (metric === 'totalVolume') return `${volume === null ? '—' : formatVolume(volume)} volume`;
  return `${formatWorkingSetCount(sets)} ${sets === 1 ? 'set' : 'sets'}`;
};

function ContributionLine({ credit, role, testID }: { credit: string | null; role: WeekBlockRole | null; testID: string }) {
  const text = useUiText();
  if (!credit) return null;
  return <Text allowFontScaling={false} style={[text.meta, styles.contribution]} testID={`${testID}-contribution`}>
    <FigureText>{`${role ? `${ROLE_LABELS[role]} · ` : ''}${credit}`}</FigureText>
  </Text>;
}

export function WeekSetList({ groups, loading, error, onOpenSession, exerciseLink, onRetry, testID, contributionMetric, period = 'week' }: Props) {
  const text = useUiText();
  const showLoading = useDelayedFlag(loading, WEEK_SETS_LOADING_DELAY_MS);
  if (error) {
    return <StatePanel action={onRetry ? { label: 'Retry', onPress: onRetry, testID: `${testID}-retry` } : undefined}
      body={error} fill={false} kind="error" testID={`${testID}-error`} title={`Could not load this ${period}'s sets`} />;
  }
  // While the next week loads, the last one's cards stay until it lands.
  if (loading && groups.length === 0) {
    return showLoading ? <StatePanel body="Loading sets..." fill={false} kind="loading" testID={`${testID}-loading`} /> : null;
  }
  if (groups.length === 0) {
    return <Text allowFontScaling={false} style={text.meta} testID={`${testID}-empty`}>No sets this {period}</Text>;
  }
  return <View style={styles.list} testID={testID}>
    {groups.map((group) => <WeekSetCard key={group.key} exerciseLink={exerciseLink} group={group} contributionMetric={contributionMetric}
      onOpenSession={onOpenSession} testID={`${testID}-card-${group.key}`} />)}
  </View>;
}

function WeekSetCard({ group, onOpenSession, exerciseLink, testID, contributionMetric }: {
  group: WeekSetGroup;
  onOpenSession: (sessionId: string) => void;
  exerciseLink?: WeekSetExerciseLink;
  testID: string;
  contributionMetric?: Props['contributionMetric'];
}) {
  const credit = contributionCredit(group, contributionMetric);
  const exerciseId = group.exerciseDefinitionId;
  const openExercise = exerciseLink && exerciseId !== null && exerciseLink.canOpen(exerciseId)
    ? () => exerciseLink.open(exerciseId)
    : null;
  const exerciseLabel = `Open ${group.title} progress`;
  const described = [group.title, group.detail === group.title ? null : group.detail, group.role ? ROLE_LABELS[group.role] : null]
    .filter(Boolean).join(', ');
  const roleMark = group.role ? <Icon colorRole="inkMuted"
    name={`role-${group.role}`} size="xs" testID={`${testID}-role-${group.role}`} /> : null;
  return <ExerciseSetsCard
    accessibilityLabel={`Open session from ${[described, credit].filter(Boolean).join(', ')}`}
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
    summary={<ContributionLine credit={credit} role={group.role} testID={testID} />}
    name={group.title} onPress={() => onOpenSession(group.sessionId)} rows={group.rows} record={group.record}
    testID={testID} />;
}

const styles = StyleSheet.create({
  list: { gap: uiSpace.md },
  contribution: { paddingHorizontal: uiSpace.md, paddingBottom: uiSpace.xs },
  // A 44pt target that leaves the header its text height: it overhangs the
  // name's line and pulls into the card's right inset.
  exerciseButton: {
    marginVertical: -(uiGeometry.tapTarget - uiTypography.lineHeight.lg) / 2,
    marginRight: -uiSpace.sm,
  },
});
