import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip-group';
import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatePanel } from '@/components/ui/state-panel';
import { Tag } from '@/components/ui/tag';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import {
  type ExerciseListItem,
  type ExerciseListPreferences,
  type ExerciseListSection,
} from '@/src/exercise-catalog/list-model';
import type { ExerciseCatalogStatsCacheStatus } from '@/src/exercise-catalog/stats-cache';

type PreferenceControlsProps = {
  preferences: ExerciseListPreferences;
  onChangePreferences: (patch: Partial<ExerciseListPreferences>) => void;
};

// One visible set of everyday controls on all three personal browsers.
export function ExerciseListPreferenceControls({ preferences, onChangePreferences }: PreferenceControlsProps) {
  return (
    <View style={styles.controlsRoot}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.sectionLabel}>Sort</Text>
      <SegmentedControl
        onChange={(sort) => onChangePreferences({ sort })}
        options={[{ value: 'favourite', label: 'Favourite' }, { value: 'name', label: 'Name A–Z' }]}
        style={styles.preferenceControl}
        testIDPrefix="exercise-list-sort"
        value={preferences.sort}
      />
      <ChipGroup
        mode="multi"
        onToggle={() => onChangePreferences({ showNeverDone: !preferences.showNeverDone })}
        options={[{ value: 'never-done', label: 'Show never-done' }]}
        style={styles.visibilityControl}
        testIDPrefix="exercise-list-visibility"
        values={preferences.showNeverDone ? ['never-done'] : []}
      />
    </View>
  );
}

type ExerciseListContentProps = {
  isSearching?: boolean;
  historyStatus?: ExerciseCatalogStatsCacheStatus;
  onRetryHistory?: () => void;
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
// page's swap sheet share: one Card per muscle family with a disclosure row.
export function ExerciseListContent({
  isSearching = false,
  historyStatus = 'ready',
  onRetryHistory,
  items,
  sections,
  expandedFamilies,
  emptyText,
  onToggleFamily,
  onPressExercise,
  getExerciseAccessibilityLabel,
  renderActions,
}: ExerciseListContentProps) {
  if (historyStatus === 'error') {
    return <StatePanel body="Unable to load exercise history." fill={false} kind="error"
      action={onRetryHistory ? { label: 'Retry', accessibilityLabel: 'Retry exercise history', onPress: onRetryHistory } : undefined} />;
  }
  if (historyStatus !== 'ready') {
    return <StatePanel body="Loading exercise history…" fill={false} kind="loading" />;
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

  return (
    <View style={styles.sections}>
      {items.length === 0 ? <StatePanel body={emptyText} fill={false} /> : null}
      {sections.map((section) => {
        const empty = section.count === 0;
        const isExpanded = !empty && (isSearching || expandedFamilies.has(section.familyName));
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
              onPress={() => { if (!isSearching) onToggleFamily(section.familyName); }}
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
  const accessibilityHint = `${exercise.muscleSummary}. ${exercise.statsSummary}.`;
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
        <Pressable accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} accessibilityRole="button" onPress={() => onPressExercise(exercise)}>
          {text}
        </Pressable>
      </ListRow>
    );
  }
  return (
    <ListRow
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
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
  preferenceControl: {
    minHeight: uiGeometry.tapTarget + uiBorder.width * 2,
  },
  visibilityControl: {
    minHeight: uiGeometry.tapTarget,
    flexWrap: 'nowrap',
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
