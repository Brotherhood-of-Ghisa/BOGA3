import { Pressable, StyleSheet, View } from 'react-native';

import { UiText, uiBorder, uiColors, uiRadius, uiSpace } from '@/components/ui';
import type { PickerGroupRow, PickerGroupSection } from '@/src/groups';

/**
 * The recorder picker's "From your groups" section (M25-T07; product E0.1,
 * D13): group exercises matching the search, listed after my own matches,
 * grouped by group. Status is text ("linked: …" / "not linked"), not color.
 */
export function PickerGroupSectionList({
  sections,
  onPressRow,
}: {
  sections: PickerGroupSection[];
  onPressRow: (row: PickerGroupRow) => void;
}) {
  if (sections.length === 0) {
    return null;
  }
  return (
    <View style={styles.section} testID="exercise-picker-group-section">
      <UiText accessibilityRole="header" style={styles.sectionHeader} variant="label">
        From your groups
      </UiText>
      {sections.map((section) => (
        <View key={section.groupId} style={styles.group}>
          {section.rows.map((row) => (
            <Pressable
              accessibilityLabel={`Group exercise ${row.groupExercise.name} in ${row.groupName}, ${row.statusLabel}`}
              accessibilityRole="button"
              key={row.key}
              onPress={() => onPressRow(row)}
              style={styles.row}
              testID={`exercise-picker-group-row-${row.groupExercise.group_exercise_id}`}>
              <UiText numberOfLines={2} style={styles.rowTitle}>
                {row.groupExercise.name}
                <UiText variant="bodyMuted"> · {row.groupName}</UiText>
              </UiText>
              <UiText numberOfLines={1} variant="bodyMuted">
                {row.statusLabel}
              </UiText>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

/** The Groups toggle beside the picker search: narrows the list to group exercises only (D13). */
export function PickerGroupsToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Show group exercises only"
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      onPress={onToggle}
      style={[styles.toggle, active ? styles.toggleActive : null]}
      testID="exercise-picker-groups-toggle">
      <UiText style={active ? styles.toggleTextActive : styles.toggleText} variant="label">
        Groups
      </UiText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: uiSpace.sm,
    marginTop: uiSpace.md,
  },
  sectionHeader: {
    color: uiColors.textSecondary,
    borderBottomWidth: uiBorder.width,
    borderBottomColor: uiColors.borderMuted,
    paddingBottom: uiSpace.xs,
  },
  group: {
    gap: uiSpace.xs,
  },
  row: {
    borderWidth: uiBorder.width,
    borderColor: uiColors.borderMuted,
    borderRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.md,
    gap: uiSpace.xs,
    minHeight: 48,
  },
  rowTitle: {
    color: uiColors.textPrimary,
  },
  toggle: {
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: uiBorder.width,
    borderColor: uiColors.actionNeutralSubtleBorder,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.actionNeutralSubtleBg,
    paddingHorizontal: uiSpace.md,
  },
  toggleActive: {
    borderColor: uiColors.actionPrimary,
    backgroundColor: uiColors.actionPrimary,
  },
  toggleText: {
    color: uiColors.actionNeutralSubtleText,
  },
  toggleTextActive: {
    color: uiColors.surfaceDefault,
  },
});
