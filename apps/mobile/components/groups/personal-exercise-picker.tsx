import { useMemo, useState } from 'react';
import { Keyboard, Text, View } from 'react-native';

import {
  Card,
  FigureText,
  Icon,
  ListRow,
  SearchField,
  makeStyles,
  uiBorder,
  uiFonts,
  uiGeometry,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { LOAD_INPUT_MODE_LABELS } from '@/src/exercise-core';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import {
  filterIndexedExerciseCatalogExercises,
  type IndexedExerciseCatalogExercise,
} from '@/src/exercise-catalog/search';

type PersonalExercisePickerProps = {
  selectedId: string | null;
  onPick: (exercise: IndexedExerciseCatalogExercise) => void;
};

export const PERSONAL_EXERCISE_RESULT_LIMIT = 30;

/**
 * Search the user's personal exercise catalog and pick one to copy into the group
 * (Add exercise → My exercises): a `SearchField` over one `Card` of radio
 * rows, the pick marked by `radio-on` in `ink` (no ground change).
 */
export function PersonalExercisePicker({ selectedId, onPick }: PersonalExercisePickerProps) {
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const { exercises } = useExerciseCatalog();

  const active = useMemo(
    () =>
      exercises
        .filter((candidate) => !candidate.deletedAt)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [exercises],
  );

  const { options, total } = useMemo(() => {
    const trimmed = query.trim();
    const matches =
      trimmed.length === 0
        ? active
        : filterIndexedExerciseCatalogExercises(active, trimmed);
    return {
      options: matches.slice(0, PERSONAL_EXERCISE_RESULT_LIMIT),
      total: matches.length,
    };
  }, [active, query]);

  return (
    <View style={styles.picker} testID="group-personal-exercise-picker">
      <Text allowFontScaling={false} style={styles.headerLabel}>
        My exercise
      </Text>
      <SearchField
        accessibilityLabel="Search my exercises"
        onChangeText={setQuery}
        placeholder="Search your exercises, e.g. bench"
        testID="group-personal-exercise-search"
        value={query}
      />
      <Card>
        {options.length === 0 ? (
          <Text
            allowFontScaling={false}
            style={styles.message}
            testID="group-personal-exercise-no-match">
            {active.length === 0
              ? "You don't have any exercises in your catalogue yet."
              : `No exercise matches "${query.trim()}".`}
          </Text>
        ) : (
          options.map((option, index) => {
            const selected = option.id === selectedId;
            const modeLabel = LOAD_INPUT_MODE_LABELS[option.loadInputMode ?? 'total_load'];
            return (
              <ListRow
                accessibilityLabel={`${option.name}, ${modeLabel}`}
                checked={selected}
                density="list"
                divider={index > 0}
                key={option.id}
                leading={<Icon name={selected ? 'radio-on' : 'radio-off'} />}
                meta={
                  <Text allowFontScaling={false} style={styles.meta}>
                    {modeLabel}
                  </Text>
                }
                onPress={() => {
                  // Bring the prefilled form below into view.
                  Keyboard.dismiss();
                  onPick(option);
                }}
                testID={`group-personal-exercise-${option.id}`}>
                <Text allowFontScaling={false} numberOfLines={2} style={styles.name}>
                  {option.name}
                </Text>
              </ListRow>
            );
          })
        )}
        {total > options.length ? (
          <Text
            allowFontScaling={false}
            style={[styles.message, styles.more]}
            testID="group-personal-exercise-more">
            <FigureText>{`Showing ${options.length} of ${total}. Search to narrow the list.`}</FigureText>
          </Text>
        ) : null}
      </Card>
    </View>
  );
}

const useStyles = makeStyles((roles) => ({
  picker: {
    gap: uiSpace.sm,
  },
  headerLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: roles.inkMuted,
  },
  name: {
    paddingVertical: uiSpace.sm,
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: roles.ink,
  },
  meta: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: roles.inkMuted,
  },
  message: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.md,
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: roles.inkMuted,
  },
  more: {
    borderTopWidth: uiBorder.width,
    borderTopColor: roles.ruleSoft,
  },
}));
