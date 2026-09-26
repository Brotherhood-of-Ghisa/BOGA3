import type { Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, Icon, ListRow, Tag, uiBorder, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
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
  /** A `rule-soft` hairline above the item (every item but the card's first). */
  divider?: boolean;
};

/**
 * One Exercises row, a slice of the section's `Card`: the name, weight entry and
 * my link status in words, an `Archived` `Tag`, a chevron when it opens the
 * exercise actions, then `Unlink…` (danger text) or `Link your exercise`
 * (outline) under it.
 */
export function GroupExerciseRow({ row, onPress, onLink, onUnlink, unlinkPending, focusRef, divider = false }: GroupExerciseRowProps) {
  const id = row.groupExerciseId;
  const label = [row.name, row.loadInputModeLabel, row.archived ? 'archived' : null, row.linkStatus]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={divider ? styles.divider : null} testID={`group-exercise-item-${id}`}>
      <ListRow
        accessibilityHint={onPress ? 'Opens exercise actions' : undefined}
        accessibilityLabel={label}
        accessible
        density="list"
        divider={false}
        meta={
          row.archived ? (
            // `Tag` hugs the top of its row; this box centres it on the text.
            <View>
              <Tag label="Archived" testID={`group-exercise-archived-${id}`} />
            </View>
          ) : undefined
        }
        onPress={onPress}
        ref={focusRef}
        testID={`group-exercise-row-${id}`}
        trailing={onPress ? <Icon color={uiRoles.inkMuted} name="chevron-right" /> : undefined}>
        <View style={styles.text}>
          <Text allowFontScaling={false} style={styles.name} testID={`group-exercise-name-${id}`}>
            {row.name}
          </Text>
          <Text allowFontScaling={false} style={styles.meta} testID={`group-exercise-load-mode-${id}`}>
            {row.loadInputModeLabel}
          </Text>
          {row.linkStatus ? (
            <Text allowFontScaling={false} style={styles.meta} testID={`group-exercise-link-status-${id}`}>
              {row.linkStatus}
            </Text>
          ) : null}
        </View>
      </ListRow>
      {onUnlink ? (
        // A text button's label carries its own inset, so it lines up with the name.
        <View style={styles.textAction}>
          <ActionButton
            accessibilityLabel={`Unlink ${row.personalLinks.length === 1 ? row.personalLinks[0].label : 'one of your exercises'} from ${row.name}`}
            disabled={unlinkPending}
            label={unlinkPending ? 'Unlinking…' : 'Unlink…'}
            onPress={onUnlink}
            testID={`group-exercise-unlink-button-${id}`}
            tone="danger"
            variant="text"
          />
        </View>
      ) : null}
      {onLink ? (
        <View style={styles.outlineAction}>
          <ActionButton
            accessibilityHint="Choose which of your exercises this is"
            accessibilityLabel={`Link your exercise to ${row.name}`}
            label="Link your exercise"
            onPress={onLink}
            testID={`group-exercise-link-button-${id}`}
            variant="outline"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  divider: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  text: {
    paddingVertical: uiSpace.sm,
  },
  name: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  meta: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  textAction: {
    alignItems: 'flex-start',
    paddingBottom: uiSpace.xs,
  },
  outlineAction: {
    alignItems: 'flex-start',
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.md,
  },
});
