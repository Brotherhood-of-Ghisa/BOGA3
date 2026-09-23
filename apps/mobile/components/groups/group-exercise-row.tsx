import type { Ref } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, UiButton, UiText, uiColors, uiRadius, uiSpace } from '@/components/ui';
import type { GroupExerciseRowViewModel } from '@/src/groups';

type GroupExerciseRowProps = {
  row: GroupExerciseRowViewModel;
  /** Set only for the owner and admins: the row then opens the exercise action sheet. */
  onPress?: () => void;
  /**
   * Set when the row offers "Link your exercise" (E0.4). It is its own button
   * beside the press target: iOS folds an accessible row's children into one
   * element, so a button inside it could not be reached on its own.
   */
  onLink?: () => void;
  onUnlink?: () => void;
  unlinkPending?: boolean;
  focusRef?: Ref<View>;
};

/** One Exercises-segment row: name, weight entry, my link status, an Archived badge, and "Link your exercise". */
export function GroupExerciseRow({ row, onPress, onLink, onUnlink, unlinkPending, focusRef }: GroupExerciseRowProps) {
  const id = row.groupExerciseId;
  const content = (
    <>
      <View style={styles.text}>
        <UiText testID={`group-exercise-name-${id}`} variant="label">
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
        <Icon color={uiColors.textSecondary} name="chevron-right" />
      ) : null}
    </>
  );
  const label = [row.name, row.loadInputModeLabel, row.archived ? 'archived' : null, row.linkStatus]
    .filter(Boolean)
    .join(', ');
  const main = onPress ? (
    <Pressable
      ref={focusRef}
      accessibilityHint="Opens exercise actions"
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.row}
      testID={`group-exercise-row-${id}`}>
      {content}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={label} ref={focusRef} style={styles.row} testID={`group-exercise-row-${id}`}>
      {content}
    </View>
  );
  return (
    <View style={styles.item} testID={`group-exercise-item-${id}`}>
      {main}
      {onUnlink ? (
        <UiButton
          accessibilityLabel={`Unlink ${row.personalLinks.length === 1 ? row.personalLinks[0].label : 'one of your exercises'} from ${row.name}`}
          disabled={unlinkPending}
          label={unlinkPending ? 'Unlinking…' : 'Unlink…'}
          onPress={onUnlink}
          style={styles.linkButton}
          testID={`group-exercise-unlink-button-${id}`}
          variant="danger"
        />
      ) : null}
      {onLink ? (
        <UiButton
          accessibilityHint="Choose which of your exercises this is"
          accessibilityLabel={`Link your exercise to ${row.name}`}
          label="Link your exercise"
          onPress={onLink}
          style={styles.linkButton}
          testID={`group-exercise-link-button-${id}`}
          variant="secondary"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    paddingBottom: uiSpace.sm,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
  },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingTop: uiSpace.md,
    paddingBottom: uiSpace.xs,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  badge: {
    borderRadius: uiRadius.full,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfacePage,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.xs,
  },
  linkButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    marginBottom: uiSpace.xs,
  },
});
