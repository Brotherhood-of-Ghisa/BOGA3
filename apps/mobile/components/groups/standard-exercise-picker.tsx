import { useMemo, useState } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';

import {
  Card,
  Icon,
  ListRow,
  SearchField,
  FigureText,
  uiBorder,
  uiRoles,
  uiSpace,
  uiText,
  uiTextTone,
} from '@/components/ui';
import { LOAD_INPUT_MODE_LABELS } from '@/src/exercise-core';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { searchStandardExercises, type StandardExerciseOption } from '@/src/groups';

type StandardExercisePickerProps = {
  selectedId: string | null;
  onPick: (option: StandardExerciseOption) => void;
};

/**
 * Search the bundled standard exercises and pick one to copy into the group
 * (Add exercise → From catalogue): a `SearchField` over one `Card` of radio
 * rows, the pick marked by `radio-on` in `ink` (no ground change).
 */
export function StandardExercisePicker({ selectedId, onPick }: StandardExercisePickerProps) {
  const [query, setQuery] = useState('');
  const { muscleSetup } = useExerciseCatalog();
  const { options, total } = useMemo(() => searchStandardExercises(query, muscleSetup), [query, muscleSetup]);

  return (
    <View style={styles.picker} testID="group-standard-exercise-picker">
      <Text allowFontScaling={false} style={uiText.label}>
        Standard exercise
      </Text>
      <SearchField
        accessibilityLabel="Search standard exercises"
        onChangeText={setQuery}
        placeholder="Search, e.g. bench"
        testID="group-standard-exercise-search"
        value={query}
      />
      <Card>
        {options.length === 0 ? (
          <Text allowFontScaling={false} style={[uiText.body, uiTextTone.muted, styles.message]} testID="group-standard-exercise-no-match">
            {`No standard exercise matches "${query.trim()}".`}
          </Text>
        ) : (
          options.map((option, index) => {
            const selected = option.sourceExerciseId === selectedId;
            const modeLabel = LOAD_INPUT_MODE_LABELS[option.loadInputMode];
            return (
              <ListRow
                accessibilityLabel={`${option.name}, ${modeLabel}`}
                checked={selected}
                density="list"
                divider={index > 0}
                key={option.sourceExerciseId}
                leading={<Icon color={uiRoles.ink} name={selected ? 'radio-on' : 'radio-off'} />}
                meta={
                  <Text allowFontScaling={false} style={[uiText.body, uiTextTone.muted]}>
                    {modeLabel}
                  </Text>
                }
                onPress={() => {
                  // Bring the prefilled form below into view.
                  Keyboard.dismiss();
                  onPick(option);
                }}
                testID={`group-standard-exercise-${option.sourceExerciseId}`}>
                <Text allowFontScaling={false} numberOfLines={2} style={[uiText.bodyStrong, styles.name]}>
                  {option.name}
                </Text>
              </ListRow>
            );
          })
        )}
        {total > options.length ? (
          <Text allowFontScaling={false} style={[uiText.body, uiTextTone.muted, styles.message, styles.more]} testID="group-standard-exercise-more">
            <FigureText>{`Showing ${options.length} of ${total}. Search to narrow the list.`}</FigureText>
          </Text>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: {
    gap: uiSpace.sm,
  },
  name: {
    paddingVertical: uiSpace.sm,
  },
  message: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.md,
  },
  more: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
});
