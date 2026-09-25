import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip-group';
import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatePanel } from '@/components/ui/state-panel';
import { Tag } from '@/components/ui/tag';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
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

type ListOption = 'group' | 'recents';

// The shared list options: the stats window as a segmented control, and the two
// list toggles as chips. Each toggle's label says what tapping it does, which
// Maestro taps ("Turn grouping off").
export function ExerciseListPreferenceControls({
  preferences,
  onChangePreferences,
}: PreferenceControlsProps) {
  const listValues: ListOption[] = [
    ...(preferences.groupByMuscleFamily ? (['group'] as const) : []),
    ...(preferences.recentsOnTop ? (['recents'] as const) : []),
  ];
  return (
    <View style={styles.controlsRoot}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.sectionLabel}>
        Date range
      </Text>
      <SegmentedControl
        onChange={(dateRange) => onChangePreferences({ dateRange })}
        options={EXERCISE_LIST_DATE_RANGE_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          accessibilityLabel: `Date range ${option.label}`,
        }))}
        testIDPrefix="exercise-list-date-range"
        value={preferences.dateRange}
      />

      <Text allowFontScaling={false} accessibilityRole="header" style={styles.sectionLabel}>
        List
      </Text>
      <ChipGroup
        mode="multi"
        onToggle={(option) =>
          onChangePreferences(
            option === 'group'
              ? { groupByMuscleFamily: !preferences.groupByMuscleFamily }
              : { recentsOnTop: !preferences.recentsOnTop }
          )
        }
        options={[
          {
            value: 'group',
            label: 'Group by muscle',
            accessibilityLabel: preferences.groupByMuscleFamily ? 'Turn grouping off' : 'Turn grouping on',
          },
          {
            value: 'recents',
            label: 'Recents on top',
            accessibilityLabel: preferences.recentsOnTop ? 'Turn recents on top off' : 'Turn recents on top on',
          },
        ]}
        testIDPrefix="exercise-list-options"
        values={listValues}
      />
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

// The exercise list the catalogue, the session view's picker and the exercise
// page's swap sheet share: hairline rows in one `Card` (flat), or one `Card` per
// muscle family headed by a disclosure row (grouped).
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
    return <StatePanel body={emptyText} fill={false} />;
  }

  const renderRow = (exercise: ExerciseListItem, index: number) => (
    <ExerciseListRow
      key={exercise.id}
      divider={index > 0}
      exercise={exercise}
      onPressExercise={onPressExercise}
      getAccessibilityLabel={getExerciseAccessibilityLabel}
      renderActions={renderActions}
    />
  );

  if (mode === 'flat') {
    return <Card>{items.map(renderRow)}</Card>;
  }

  return (
    <View style={styles.sections}>
      {sections.map((section) => {
        const isExpanded = expandedFamilies.has(section.familyName);
        const empty = section.count === 0;
        return (
          <Card key={section.familyName}>
            <ListRow
              accessibilityLabel={`${section.familyName} exercises ${section.count}`}
              density="list"
              disabled={empty}
              divider={false}
              expanded={isExpanded}
              label={section.familyName}
              meta={<Text allowFontScaling={false} style={[styles.familyCount, empty ? styles.familyCountEmpty : null]}>{section.count}</Text>}
              onPress={() => onToggleFamily(section.familyName)}
              testID={getFamilyGroupTestId(section.familyName)}
              trailing={
                <Icon
                  color={empty ? uiRoles.disabled : uiRoles.inkMuted}
                  name={isExpanded ? 'chevron-down' : 'chevron-right'}
                  size="sm"
                />
              }
            />
            {isExpanded ? section.exercises.map((exercise) => renderRow(exercise, 1)) : null}
          </Card>
        );
      })}
    </View>
  );
}

type ExerciseListRowProps = {
  exercise: ExerciseListItem;
  divider: boolean;
  onPressExercise: (exercise: ExerciseListItem) => void;
  getAccessibilityLabel?: (exercise: ExerciseListItem) => string;
  renderActions?: (exercise: ExerciseListItem) => ReactNode;
};

// Name, muscles and the stats line. A deleted exercise steps back: a faint
// `Deleted` tag and faint text, never a warning hue.
const ExerciseListRow = memo(function ExerciseListRow({
  exercise,
  divider,
  onPressExercise,
  getAccessibilityLabel,
  renderActions,
}: ExerciseListRowProps) {
  const deleted = Boolean(exercise.deletedAt);
  const accessibilityLabel = getAccessibilityLabel?.(exercise) ?? `Select exercise ${exercise.name}`;
  const text = (
    <View style={styles.rowText}>
      <View style={styles.titleRow}>
        <Text allowFontScaling={false}
          adjustsFontSizeToFit
          ellipsizeMode="clip"
          minimumFontScale={0.82}
          numberOfLines={2}
          style={[styles.name, deleted ? styles.faded : null]}>
          {exercise.name}
        </Text>
        {deleted ? <Tag label="Deleted" tone="faint" /> : null}
      </View>
      <Text allowFontScaling={false}
        adjustsFontSizeToFit
        ellipsizeMode="clip"
        minimumFontScale={0.82}
        numberOfLines={1}
        style={[styles.muscles, deleted ? styles.faded : null]}>
        {exercise.muscleSummary}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.stats, deleted ? styles.faded : null]}>
        {exercise.statsSummary}
      </Text>
    </View>
  );

  // With row actions (the catalogue's ⋮) the text is its own target beside
  // them, so both stay reachable to VoiceOver; otherwise the row is one target.
  if (renderActions) {
    return (
      <ListRow density="list" divider={divider} trailing={renderActions(exercise)}>
        <Pressable accessibilityLabel={accessibilityLabel} onPress={() => onPressExercise(exercise)}>
          {text}
        </Pressable>
      </ListRow>
    );
  }
  return (
    <ListRow
      accessibilityLabel={accessibilityLabel}
      density="list"
      divider={divider}
      onPress={() => onPressExercise(exercise)}>
      {text}
    </ListRow>
  );
});

function getFamilyGroupTestId(familyName: string): string {
  return `exercise-family-group-${familyName.toLowerCase().replace(/\s+/g, '-')}`;
}

const styles = StyleSheet.create({
  controlsRoot: {
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
  sections: {
    gap: uiSpace.sm,
  },
  familyCount: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  familyCountEmpty: {
    color: uiRoles.disabled,
  },
  rowText: {
    paddingVertical: uiSpace.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  name: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  muscles: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.inkMuted,
  },
  stats: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
  faded: {
    color: uiRoles.inkFaint,
  },
});
