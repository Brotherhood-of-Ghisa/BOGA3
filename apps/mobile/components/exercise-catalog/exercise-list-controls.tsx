import { memo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
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
  // Chips of the host's own between Never-done and Sort (the picker's Groups).
  children?: ReactNode;
};

const SORT_LABELS = { favourite: 'Favourite', name: 'A–Z' } as const;

// One row of everyday controls on all three personal browsers: the Never-done
// filter, the host's own chips, and Sort, which switches between the two orders.
export function ExerciseListPreferenceControls({ preferences, onChangePreferences, children }: PreferenceControlsProps) {
  const nextSort = preferences.sort === 'favourite' ? 'name' : 'favourite';
  return (
    <View style={styles.controlsRow} testID="exercise-list-controls">
      <FilterChip
        accessibilityLabel="Show never-done"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: preferences.showNeverDone }}
        label="Never-done"
        on={preferences.showNeverDone}
        onPress={() => onChangePreferences({ showNeverDone: !preferences.showNeverDone })}
        testID="exercise-list-never-done"
      />
      {children}
      <FilterChip
        accessibilityHint={`Sorts by ${nextSort === 'name' ? 'name A to Z' : 'favourite'}`}
        accessibilityLabel={`Sort: ${SORT_LABELS[preferences.sort]}`}
        accessibilityRole="button"
        label={`Sort: ${SORT_LABELS[preferences.sort]}`}
        on={false}
        onPress={() => onChangePreferences({ sort: nextSort })}
        testID="exercise-list-sort"
      />
    </View>
  );
}

type FilterChipProps = {
  label: string;
  on: boolean;
  onPress: () => void;
  testID: string;
  accessibilityLabel: string;
  accessibilityRole: 'button' | 'checkbox' | 'switch';
  accessibilityState?: { checked: boolean };
  accessibilityHint?: string;
};

// A pill one tap target tall; solid `ink` while on, so the state never rides
// colour alone (the role and checked state carry it too). The picker's Groups
// toggle draws the same pill.
export function FilterChip({ label, on, onPress, testID, ...a11y }: FilterChipProps) {
  return (
    <Pressable
      {...a11y}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, on ? styles.chipOn : null, pressed && !on ? styles.chipPressed : null]}
      testID={testID}>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.chipLabel, on ? styles.chipLabelOn : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

export type FamilyExpansion = {
  isExpanded: (familyName: string) => boolean;
  toggle: (familyName: string) => void;
};

const flip = (set: ReadonlySet<string>, familyName: string): ReadonlySet<string> => {
  const next = new Set(set);
  if (next.has(familyName)) next.delete(familyName);
  else next.add(familyName);
  return next;
};

// The muscle families' open state. Browsing, every family starts closed and a
// tap opens it; searching, every family with matches starts open and a tap
// closes it, until the search is cleared and started again.
export function useFamilyExpansion(isSearching: boolean): FamilyExpansion {
  const [openWhileBrowsing, setOpenWhileBrowsing] = useState<ReadonlySet<string>>(() => new Set());
  const [closedWhileSearching, setClosedWhileSearching] = useState<ReadonlySet<string>>(() => new Set());
  const [wasSearching, setWasSearching] = useState(isSearching);
  if (wasSearching !== isSearching) {
    setWasSearching(isSearching);
    if (isSearching) setClosedWhileSearching(new Set());
  }
  return {
    isExpanded: (familyName) =>
      isSearching ? !closedWhileSearching.has(familyName) : openWhileBrowsing.has(familyName),
    toggle: (familyName) =>
      isSearching
        ? setClosedWhileSearching((current) => flip(current, familyName))
        : setOpenWhileBrowsing((current) => flip(current, familyName)),
  };
}

type ExerciseListContentProps = {
  historyStatus?: ExerciseCatalogStatsCacheStatus;
  onRetryHistory?: () => void;
  items: ExerciseListItem[];
  sections: ExerciseListSection[];
  familyExpansion: FamilyExpansion;
  emptyText: string;
  onPressExercise: (exercise: ExerciseListItem) => void;
  getExerciseAccessibilityLabel?: (exercise: ExerciseListItem) => string;
  renderActions?: (exercise: ExerciseListItem) => ReactNode;
};

// The exercise list the catalogue, the session's exercise picker and the
// exercise page's swap sheet share: one Card per muscle family with a
// disclosure row.
export function ExerciseListContent({
  historyStatus = 'ready',
  onRetryHistory,
  items,
  sections,
  familyExpansion,
  emptyText,
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
        const isExpanded = !empty && familyExpansion.isExpanded(section.familyName);
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
              onPress={() => familyExpansion.toggle(section.familyName)}
              testID={getFamilyGroupTestId(section.familyName)}
              trailing={
                <Icon
                  color={empty ? uiRoles.inkGhost : uiRoles.inkMuted}
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
  // One row; on the narrowest phones the last chip wraps rather than scrolling.
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  chip: {
    minHeight: uiGeometry.tapTarget,
    justifyContent: 'center',
    paddingHorizontal: uiSpace.md,
    backgroundColor: uiRoles.surface,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.pill,
  },
  chipOn: {
    backgroundColor: uiRoles.ink,
    borderColor: uiRoles.ink,
  },
  chipPressed: {
    backgroundColor: uiRoles.paper,
  },
  chipLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
  chipLabelOn: {
    color: uiRoles.surface,
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
    color: uiRoles.inkGhost,
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
