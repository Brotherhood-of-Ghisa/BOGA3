import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { UiSurface, UiText, uiColors, uiRadius, uiSpace } from '@/components/ui';
import { LOAD_INPUT_MODE_LABELS } from '@/src/exercise-core';
import { searchStandardExercises, type StandardExerciseOption } from '@/src/groups';

import { groupFormStyles } from './screen-styles';

type StandardExercisePickerProps = {
  selectedId: string | null;
  onPick: (option: StandardExerciseOption) => void;
};

/** Search the bundled standard exercises and pick one to copy into the group (Add exercise → From catalogue). */
export function StandardExercisePicker({ selectedId, onPick }: StandardExercisePickerProps) {
  const [query, setQuery] = useState('');
  const { options, total } = useMemo(() => searchStandardExercises(query), [query]);

  return (
    <View style={groupFormStyles.field} testID="group-standard-exercise-picker">
      <UiText variant="subtitle">Standard exercise</UiText>
      <TextInput
        accessibilityLabel="Search standard exercises"
        autoCorrect={false}
        onChangeText={setQuery}
        placeholder="Search, e.g. bench"
        placeholderTextColor={uiColors.textDisabled}
        style={groupFormStyles.input}
        testID="group-standard-exercise-search"
        value={query}
      />
      <UiSurface style={styles.list}>
        {options.length === 0 ? (
          <UiText testID="group-standard-exercise-no-match" variant="bodyMuted">
            {`No standard exercise matches "${query.trim()}".`}
          </UiText>
        ) : (
          options.map((option) => {
            const selected = option.sourceExerciseId === selectedId;
            const modeLabel = LOAD_INPUT_MODE_LABELS[option.loadInputMode];
            return (
              <Pressable
                accessibilityLabel={`${option.name}, ${modeLabel}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={option.sourceExerciseId}
                onPress={() => {
                  // Bring the prefilled form below into view.
                  Keyboard.dismiss();
                  onPick(option);
                }}
                style={[styles.row, selected ? styles.rowSelected : null]}
                testID={`group-standard-exercise-${option.sourceExerciseId}`}>
                <UiText numberOfLines={2} style={styles.name} variant="label">
                  {option.name}
                </UiText>
                <UiText variant="subtitle">{modeLabel}</UiText>
              </Pressable>
            );
          })
        )}
        {total > options.length ? (
          <UiText testID="group-standard-exercise-more" variant="subtitle">
            {`Showing ${options.length} of ${total}. Search to narrow the list.`}
          </UiText>
        ) : null}
      </UiSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: uiSpace.sm,
    gap: uiSpace.xs,
  },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
  },
  rowSelected: {
    borderColor: uiColors.actionPrimary,
    backgroundColor: uiColors.actionPrimarySubtleBg,
  },
  name: {
    flex: 1,
    minWidth: 0,
  },
});
