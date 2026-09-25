import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { PickerGroupRow, PickerGroupSection } from '@/src/groups';

/**
 * The exercise picker's "From your groups" section (M25-T07; product E0.1,
 * D13): group exercises matching the search, listed after my own matches,
 * one card per group. Status is text ("linked: …" / "not linked"), not color.
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
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.sectionLabel}>
        From your groups
      </Text>
      {sections.map((section) => (
        <Card key={section.groupId}>
          {section.rows.map((row, index) => (
            <ListRow
              accessibilityLabel={`Group exercise ${row.groupExercise.name} in ${row.groupName}, ${row.statusLabel}`}
              density="list"
              divider={index > 0}
              key={row.key}
              onPress={() => onPressRow(row)}
              testID={`exercise-picker-group-row-${row.groupExercise.group_exercise_id}`}>
              <View style={styles.rowText}>
                <Text allowFontScaling={false} numberOfLines={2} style={styles.name}>
                  {row.groupExercise.name}
                  <Text allowFontScaling={false} style={styles.groupName}> · {row.groupName}</Text>
                </Text>
                <Text allowFontScaling={false} numberOfLines={1} style={styles.status}>
                  {row.statusLabel}
                </Text>
              </View>
            </ListRow>
          ))}
        </Card>
      ))}
    </View>
  );
}

/**
 * The Groups toggle beside the picker search: narrows the list to group
 * exercises only (D13). A chip, solid `ink` while on, as `ChipGroup` draws one;
 * a switch to assistive tech.
 */
export function PickerGroupsToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Show group exercises only"
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      onPress={onToggle}
      style={({ pressed }) => [styles.toggle, active ? styles.toggleOn : null, pressed && !active ? styles.pressed : null]}
      testID="exercise-picker-groups-toggle">
      <Text allowFontScaling={false} style={[styles.toggleLabel, active ? styles.toggleLabelOn : null]}>Groups</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: uiSpace.sm,
  },
  sectionLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  rowText: {
    paddingVertical: uiSpace.sm,
  },
  name: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  groupName: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    color: uiRoles.inkMuted,
  },
  status: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.inkMuted,
  },
  toggle: {
    minHeight: uiGeometry.tapTarget,
    justifyContent: 'center',
    paddingHorizontal: uiSpace.md,
    backgroundColor: uiRoles.surface,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.ruleStrong,
    borderRadius: uiGeometry.radius.pill,
  },
  toggleOn: {
    backgroundColor: uiRoles.ink,
    borderColor: uiRoles.ink,
  },
  pressed: {
    backgroundColor: uiRoles.surfaceSubtle,
  },
  toggleLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
  toggleLabelOn: {
    color: uiRoles.surface,
  },
});
