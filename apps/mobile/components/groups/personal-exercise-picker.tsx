import { useEffect, useMemo, useState } from 'react';
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
import { GroupLoadingState } from '@/components/groups/group-state-view';
import { LOAD_INPUT_MODE_LABELS } from '@/src/exercise-core';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import {
  filterIndexedExerciseCatalogExercises,
  type IndexedExerciseCatalogExercise,
} from '@/src/exercise-catalog/search';
import { describeAlreadyLinkedIn, linkedExerciseIdsInGroup } from '@/src/groups/link-view-model';
import { listLinks } from '@/src/data/exercise-group-links';

type PersonalExercisePickerProps = {
  selectedId: string | null;
  onPick: (exercise: IndexedExerciseCatalogExercise) => void;
  groupId?: string;
  groupName?: string;
  unavailableExerciseIds?: ReadonlySet<string>;
};

export const PERSONAL_EXERCISE_RESULT_LIMIT = 30;

/**
 * Search the user's personal exercise catalog and pick one to copy into the group
 * (Add exercise → My exercises): a `SearchField` over one `Card` of radio
 * rows, the pick marked by `radio-on` in `ink` (no ground change).
 *
 * Exercises already linked in this group are marked disabled and indicate
 * their link status to prevent stealth link re-targeting.
 */
export function PersonalExercisePicker({
  selectedId,
  onPick,
  groupId,
  groupName,
  unavailableExerciseIds,
}: PersonalExercisePickerProps) {
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const catalog = useExerciseCatalog();
  const [fetchedLinks, setFetchedLinks] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (unavailableExerciseIds || !groupId) {
      return;
    }
    let active = true;
    listLinks()
      .then((links) => {
        if (!active) return;
        setFetchedLinks(linkedExerciseIdsInGroup(groupId, links));
      })
      .catch(() => {
        if (!active) return;
        setFetchedLinks(new Set());
      });
    return () => {
      active = false;
    };
  }, [groupId, unavailableExerciseIds]);

  const linkedInGroup = unavailableExerciseIds ?? fetchedLinks;

  const active = useMemo(
    () =>
      catalog.exercises
        .filter((candidate) => !candidate.deletedAt)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [catalog.exercises],
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
        {catalog.status === 'idle' || catalog.status === 'loading' ? (
          <GroupLoadingState testID="group-personal-exercise-loading" />
        ) : catalog.status === 'error' ? (
          <Text
            allowFontScaling={false}
            style={styles.message}
            testID="group-personal-exercise-error">
            {catalog.lastError
              ? `Failed to load exercises: ${catalog.lastError}`
              : 'Failed to load exercises.'}
          </Text>
        ) : options.length === 0 ? (
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
            const unavailableReason = linkedInGroup.has(option.id)
              ? describeAlreadyLinkedIn(groupName ?? 'this group')
              : null;
            const isUnavailable = unavailableReason !== null;

            return (
              <ListRow
                accessibilityLabel={
                  unavailableReason
                    ? `${option.name}, ${unavailableReason}`
                    : `${option.name}, ${modeLabel}`
                }
                checked={selected}
                density="list"
                disabled={isUnavailable}
                divider={index > 0}
                key={option.id}
                leading={
                  <Icon
                    colorRole={isUnavailable ? 'inkMuted' : 'ink'}
                    name={selected ? 'radio-on' : 'radio-off'}
                  />
                }
                meta={
                  <Text
                    allowFontScaling={false}
                    style={[styles.meta, isUnavailable && styles.metaDisabled]}>
                    {unavailableReason ?? modeLabel}
                  </Text>
                }
                onPress={() => {
                  if (isUnavailable) return;
                  // Bring the prefilled form below into view.
                  Keyboard.dismiss();
                  onPick(option);
                }}
                testID={`group-personal-exercise-${option.id}`}>
                <Text
                  allowFontScaling={false}
                  numberOfLines={2}
                  style={[styles.name, isUnavailable && styles.nameDisabled]}>
                  {option.name}
                </Text>
              </ListRow>
            );
          })
        )}
        {catalog.status === 'ready' && total > options.length ? (
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
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: roles.ink,
  },
  nameDisabled: {
    color: roles.inkMuted,
  },
  meta: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: roles.inkMuted,
  },
  metaDisabled: {
    color: roles.inkMuted,
  },
  message: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.md,
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: roles.inkMuted,
  },
  more: {
    borderTopWidth: uiBorder.width,
    borderTopColor: roles.ruleSoft,
  },
}));
