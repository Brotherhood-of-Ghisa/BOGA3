import { Pressable, StyleSheet, View } from 'react-native';

import { UiText, uiColors, uiRadius, uiSpace } from '@/components/ui';
import type { GroupExerciseRowViewModel } from '@/src/groups';

type GroupExerciseRowProps = {
  row: GroupExerciseRowViewModel;
  /** Set only for the owner and admins: the row then opens the exercise action sheet. */
  onPress?: () => void;
};

/** One Exercises-segment row: name, weight entry, my link status, and an Archived badge. */
export function GroupExerciseRow({ row, onPress }: GroupExerciseRowProps) {
  const id = row.groupExerciseId;
  const content = (
    <>
      <View style={styles.text}>
        <UiText numberOfLines={2} testID={`group-exercise-name-${id}`} variant="label">
          {row.name}
        </UiText>
        <UiText testID={`group-exercise-load-mode-${id}`} variant="subtitle">
          {row.loadInputModeLabel}
        </UiText>
        {row.linkStatus ? (
          <UiText testID={`group-exercise-link-status-${id}`} variant="bodyMuted">
            {row.linkStatus}
          </UiText>
        ) : null}
      </View>
      {row.archived ? (
        <View style={styles.badge}>
          <UiText testID={`group-exercise-archived-${id}`} variant="subtitle">
            Archived
          </UiText>
        </View>
      ) : null}
      {onPress ? (
        <UiText style={styles.chevron} variant="label">
          ›
        </UiText>
      ) : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.row} testID={`group-exercise-row-${id}`}>
        {content}
      </View>
    );
  }
  const label = [row.name, row.loadInputModeLabel, row.archived ? 'archived' : null, row.linkStatus]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityHint="Opens exercise actions"
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.row}
      testID={`group-exercise-row-${id}`}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingVertical: uiSpace.md,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xxs,
  },
  chevron: {
    color: uiColors.textSecondary,
  },
  badge: {
    borderRadius: uiRadius.full,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfacePage,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.xxs,
  },
});
