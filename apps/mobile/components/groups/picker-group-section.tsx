import { StyleSheet, Text, View } from 'react-native';

import { FilterChip } from '@/components/exercise-catalog/exercise-list-controls';
import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiSpace } from '@/components/ui/tokens';
import type { PickerGroupRow, PickerGroupSection } from '@/src/groups';

/**
 * The exercise picker's "From your groups" section (E0.1, D13): group exercises matching the search, listed after my own matches,
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
      <Text allowFontScaling={false} accessibilityRole="header" style={uiText.label}>
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
                <Text allowFontScaling={false} numberOfLines={2} style={uiText.bodyStrong}>
                  {row.groupExercise.name}
                  <Text allowFontScaling={false} style={[uiText.body, uiTextTone.muted]}> · {row.groupName}</Text>
                </Text>
                <Text allowFontScaling={false} numberOfLines={1} style={uiText.meta}>
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
 * The Groups chip in the picker's filter row: narrows the list to group
 * exercises only (D13). Solid `ink` while on; a switch to assistive tech.
 */
export function PickerGroupsToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <FilterChip
      accessibilityLabel="Show group exercises only"
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      label="Groups"
      on={active}
      onPress={onToggle}
      testID="exercise-picker-groups-toggle"
    />
  );
}

const styles = StyleSheet.create({
  section: {
    gap: uiSpace.sm,
  },
  rowText: {
    paddingVertical: uiSpace.sm,
  },
});
