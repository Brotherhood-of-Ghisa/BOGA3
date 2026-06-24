import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { uiColors } from '@/components/ui';
import {
  EXERCISE_LIST_DATE_RANGE_OPTIONS,
  type ExerciseListItem,
  type ExerciseListPreferences,
  type ExerciseListSection,
} from '@/src/exercise-catalog/list-model';

type PreferenceControlsProps = {
  preferences: ExerciseListPreferences;
  onChangePreferences: (patch: Partial<ExerciseListPreferences>) => void;
};

export function ExerciseListPreferenceControls({
  preferences,
  onChangePreferences,
}: PreferenceControlsProps) {
  return (
    <View style={styles.controlsRoot}>
      <Text selectable style={styles.sectionLabel}>
        Date range
      </Text>
      <View style={styles.pillRow}>
        {EXERCISE_LIST_DATE_RANGE_OPTIONS.map((option) => {
          const selected = preferences.dateRange === option.value;
          return (
            <Pressable
              key={String(option.value)}
              accessibilityLabel={`Date range ${option.label}`}
              style={[styles.filterPill, selected && styles.filterPillSelected]}
              onPress={() => onChangePreferences({ dateRange: option.value })}>
              <Text style={[styles.filterPillText, selected && styles.filterPillTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text selectable style={styles.sectionLabel}>
        List
      </Text>
      <View style={styles.pillRow}>
        <Pressable
          accessibilityLabel={
            preferences.groupByMuscleFamily
              ? 'Turn grouping off'
              : 'Turn grouping on'
          }
          style={[
            styles.filterPill,
            preferences.groupByMuscleFamily && styles.filterPillSelected,
          ]}
          onPress={() =>
            onChangePreferences({ groupByMuscleFamily: !preferences.groupByMuscleFamily })
          }>
          <Text
            style={[
              styles.filterPillText,
              preferences.groupByMuscleFamily && styles.filterPillTextSelected,
            ]}>
            Group by muscle
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel={
            preferences.recentsOnTop
              ? 'Turn recents on top off'
              : 'Turn recents on top on'
          }
          style={[styles.filterPill, preferences.recentsOnTop && styles.filterPillSelected]}
          onPress={() => onChangePreferences({ recentsOnTop: !preferences.recentsOnTop })}>
          <Text
            style={[
              styles.filterPillText,
              preferences.recentsOnTop && styles.filterPillTextSelected,
            ]}>
            Recents on top
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

type ExerciseListContentProps = {
  mode: 'grouped' | 'flat';
  items: ExerciseListItem[];
  sections: ExerciseListSection[];
  expandedFamilies: ReadonlySet<string>;
  emptyText: string;
  onToggleFamily: (familyName: string) => void;
  onPressExercise: (exercise: ExerciseListItem) => void;
  getExerciseAccessibilityLabel?: (exercise: ExerciseListItem) => string;
  renderActions?: (exercise: ExerciseListItem) => ReactNode;
};

export function ExerciseListContent({
  mode,
  items,
  sections,
  expandedFamilies,
  emptyText,
  onToggleFamily,
  onPressExercise,
  getExerciseAccessibilityLabel,
  renderActions,
}: ExerciseListContentProps) {
  if (items.length === 0 && mode === 'flat') {
    return (
      <Text selectable style={styles.helperText}>
        {emptyText}
      </Text>
    );
  }

  if (mode === 'flat') {
    return (
      <>
        {items.map((exercise) => (
          <ExerciseListRow
            key={exercise.id}
            exercise={exercise}
            onPressExercise={onPressExercise}
            getAccessibilityLabel={getExerciseAccessibilityLabel}
            renderActions={renderActions}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {sections.map((section) => {
        const isExpanded = expandedFamilies.has(section.familyName);
        return (
          <View key={section.familyName} style={styles.groupSection}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${section.familyName} exercises ${section.count}`}
              accessibilityState={{ disabled: section.count === 0, expanded: isExpanded }}
              disabled={section.count === 0}
              testID={getFamilyGroupTestId(section.familyName)}
              style={[
                styles.groupHeader,
                section.count === 0 ? styles.groupHeaderDisabled : null,
              ]}
              onPress={() => onToggleFamily(section.familyName)}>
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                numberOfLines={1}
                style={[
                  styles.groupHeaderText,
                  section.count === 0 ? styles.groupHeaderTextDisabled : null,
                ]}>
                {section.familyName} · {section.count}
              </Text>
            </Pressable>
            {isExpanded
              ? section.exercises.map((exercise) => (
                  <ExerciseListRow
                    key={exercise.id}
                    exercise={exercise}
                    onPressExercise={onPressExercise}
                    getAccessibilityLabel={getExerciseAccessibilityLabel}
                    renderActions={renderActions}
                  />
                ))
              : null}
          </View>
        );
      })}
    </>
  );
}

type ExerciseListRowProps = {
  exercise: ExerciseListItem;
  onPressExercise: (exercise: ExerciseListItem) => void;
  getAccessibilityLabel?: (exercise: ExerciseListItem) => string;
  renderActions?: (exercise: ExerciseListItem) => ReactNode;
};

const ExerciseListRow = memo(function ExerciseListRow({
  exercise,
  onPressExercise,
  getAccessibilityLabel,
  renderActions,
}: ExerciseListRowProps) {
  return (
    <View style={styles.exerciseListRow}>
      <Pressable
        accessibilityLabel={getAccessibilityLabel?.(exercise) ?? `Select exercise ${exercise.name}`}
        style={styles.exerciseListRowMainPressable}
        onPress={() => onPressExercise(exercise)}>
        <View style={styles.exerciseListRowTextStack}>
          <View style={styles.exerciseListRowTitleRow}>
            <Text
              adjustsFontSizeToFit
              ellipsizeMode="clip"
              minimumFontScale={0.82}
              numberOfLines={2}
              style={styles.exerciseListRowTitle}>
              {exercise.name}
            </Text>
            {exercise.deletedAt ? (
              <Text selectable style={styles.deletedExerciseChip}>
                Deleted
              </Text>
            ) : null}
          </View>
          <Text
            adjustsFontSizeToFit
            ellipsizeMode="clip"
            minimumFontScale={0.82}
            numberOfLines={1}
            style={styles.exerciseListRowMuscleSummary}>
            {exercise.muscleSummary}
          </Text>
          <Text numberOfLines={1} style={styles.exerciseListRowStats}>
            {exercise.statsSummary}
          </Text>
        </View>
      </Pressable>
      {renderActions ? renderActions(exercise) : null}
    </View>
  );
});

function getFamilyGroupTestId(familyName: string): string {
  return `exercise-family-group-${familyName.toLowerCase().replace(/\s+/g, '-')}`;
}

const styles = StyleSheet.create({
  controlsRoot: {
    gap: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: uiColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 6,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  filterPillSelected: {
    backgroundColor: uiColors.actionPrimarySubtleBg,
    borderColor: uiColors.actionPrimary,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  filterPillTextSelected: {
    color: uiColors.actionPrimary,
    fontWeight: '700',
  },
  helperText: {
    fontSize: 13,
    color: uiColors.textSecondary,
  },
  groupSection: {
    gap: 6,
  },
  groupHeader: {
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceMuted,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  groupHeaderDisabled: {
    opacity: 0.62,
  },
  groupHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  groupHeaderTextDisabled: {
    color: uiColors.textSecondary,
  },
  exerciseListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    backgroundColor: uiColors.surfaceDefault,
  },
  exerciseListRowMainPressable: {
    flex: 1,
  },
  exerciseListRowTextStack: {
    flex: 1,
    gap: 1,
  },
  exerciseListRowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  exerciseListRowTitle: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  exerciseListRowMuscleSummary: {
    fontSize: 11,
    color: uiColors.textSecondary,
    fontWeight: '600',
  },
  exerciseListRowStats: {
    fontSize: 11,
    color: uiColors.textAccentMuted,
    fontWeight: '600',
    marginTop: 2,
  },
  deletedExerciseChip: {
    fontSize: 9,
    fontWeight: '700',
    color: uiColors.textWarning,
    borderWidth: 1,
    borderColor: uiColors.borderWarning,
    backgroundColor: uiColors.surfaceWarning,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
});
