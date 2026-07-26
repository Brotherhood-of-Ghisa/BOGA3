import { Fragment, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { UiSurface, UiText, uiColors, uiSpace } from '@/components/ui';

export type SessionContentSetValue = {
  id: string;
};

export type SessionContentExerciseValue<TSet extends SessionContentSetValue = SessionContentSetValue> = {
  id: string;
  name: string;
  machineName?: string | null;
  sets: TSet[];
};

type ExerciseCardProps = Omit<ComponentProps<typeof UiSurface>, 'children'>;

type SessionContentLayoutProps<
  TSet extends SessionContentSetValue,
  TExercise extends SessionContentExerciseValue<TSet>,
> = {
  showMetadataSection?: boolean;
  dateTimeValue: ReactNode;
  gymValue: ReactNode;
  exercises: TExercise[];
  emptyExercisesText?: string;
  collapsedExerciseIds?: Set<string>;
  onToggleExerciseCollapse?: (exerciseId: string) => void;
  renderSetRow: (input: {
    exercise: TExercise;
    exerciseIndex: number;
    set: TSet;
    setIndex: number;
  }) => ReactNode;
  renderSetHeader?: (input: {
    exercise: TExercise;
    exerciseIndex: number;
  }) => ReactNode;
  renderExerciseHeaderAction?: (input: {
    exercise: TExercise;
    exerciseIndex: number;
  }) => ReactNode;
  renderExerciseMeta?: (input: {
    exercise: TExercise;
    exerciseIndex: number;
  }) => ReactNode;
  getExerciseCardProps?: (input: {
    exercise: TExercise;
    exerciseIndex: number;
  }) => ExerciseCardProps;
  renderExerciseFooter?: (input: {
    exercise: TExercise;
    exerciseIndex: number;
  }) => ReactNode;
  renderEmptyState?: (text: string) => ReactNode;
};

export function SessionContentLayout<
  TSet extends SessionContentSetValue,
  TExercise extends SessionContentExerciseValue<TSet> = SessionContentExerciseValue<TSet>,
>({
  showMetadataSection = true,
  dateTimeValue,
  gymValue,
  exercises,
  emptyExercisesText = 'No exercises logged yet.',
  collapsedExerciseIds,
  onToggleExerciseCollapse,
  renderSetRow,
  renderSetHeader,
  renderExerciseHeaderAction,
  renderExerciseMeta,
  getExerciseCardProps,
  renderExerciseFooter,
  renderEmptyState,
}: SessionContentLayoutProps<TSet, TExercise>) {
  return (
    <>
      {showMetadataSection ? (
        <UiSurface style={styles.section} variant="panelMuted">
          <View style={styles.topRow}>
            <View style={styles.rowField}>
              <UiText variant="label">Date and Time</UiText>
              {dateTimeValue}
            </View>

            <View style={styles.rowField}>
              <UiText variant="label">Gym</UiText>
              {gymValue}
            </View>
          </View>
        </UiSurface>
      ) : null}

      <View style={styles.exerciseList}>
        {exercises.map((exercise, exerciseIndex) => {
          const exerciseCardProps = getExerciseCardProps?.({ exercise, exerciseIndex });
          const isCollapsed = collapsedExerciseIds?.has(exercise.id) ?? false;

          return (
            <UiSurface
              key={exercise.id}
              {...exerciseCardProps}
              style={[styles.exerciseCard, exerciseCardProps?.style]}>
              <View style={styles.exerciseCardHeader}>
                <Pressable
                  accessibilityHint={isCollapsed ? 'Tap to expand exercise' : 'Tap to collapse exercise'}
                  accessibilityLabel={`Toggle collapse exercise ${exercise.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !isCollapsed }}
                  disabled={!onToggleExerciseCollapse}
                  style={styles.exerciseHeaderTitlePressable}
                  testID={`exercise-collapse-toggle-${exerciseIndex + 1}`}
                  onPress={() => onToggleExerciseCollapse?.(exercise.id)}>
                  <View style={styles.exerciseHeaderTextStack}>
                    <View style={styles.exerciseTitleRow}>
                      <UiText
                        adjustsFontSizeToFit
                        ellipsizeMode="clip"
                        minimumFontScale={0.82}
                        numberOfLines={2}
                        variant="title">
                        {exercise.name || `Exercise ${exerciseIndex + 1}`}
                      </UiText>
                      {onToggleExerciseCollapse ? (
                        <UiText style={styles.collapseChevronText}>
                          {isCollapsed ? '▾' : '▴'}
                        </UiText>
                      ) : null}
                    </View>
                    {exercise.machineName?.trim() ? (
                      <UiText
                        adjustsFontSizeToFit
                        ellipsizeMode="clip"
                        minimumFontScale={0.82}
                        numberOfLines={1}
                        variant="subtitle">
                        {exercise.machineName.trim()}
                      </UiText>
                    ) : null}
                    {isCollapsed ? (
                      <UiText variant="subtitle">
                        {`${exercise.sets.length} ${exercise.sets.length === 1 ? 'set' : 'sets'}`}
                      </UiText>
                    ) : null}
                  </View>
                </Pressable>
                {renderExerciseHeaderAction ? renderExerciseHeaderAction({ exercise, exerciseIndex }) : null}
              </View>

              {!isCollapsed && renderExerciseMeta ? renderExerciseMeta({ exercise, exerciseIndex }) : null}

              {!isCollapsed ? (
                <View style={styles.setList}>
                  {renderSetHeader && exercise.sets.length > 0 ? renderSetHeader({ exercise, exerciseIndex }) : null}
                  {exercise.sets.map((set, setIndex) => (
                    <Fragment key={set.id}>
                      {renderSetRow({
                        exercise,
                        exerciseIndex,
                        set,
                        setIndex,
                      })}
                    </Fragment>
                  ))}
                </View>
              ) : null}

              {!isCollapsed && renderExerciseFooter ? renderExerciseFooter({ exercise, exerciseIndex }) : null}
            </UiSurface>
          );
        })}

        {exercises.length === 0
          ? renderEmptyState
            ? renderEmptyState(emptyExercisesText)
            : (
              <UiText variant="bodyMuted">{emptyExercisesText}</UiText>
            )
          : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    padding: uiSpace.lg,
    gap: uiSpace.lg,
  },
  topRow: {
    flexDirection: 'row',
    gap: uiSpace.md,
    alignItems: 'flex-start',
  },
  rowField: {
    flex: 1,
    gap: uiSpace.sm - 2,
  },
  exerciseList: {
    gap: uiSpace.lg,
  },
  exerciseCard: {
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  exerciseHeaderTitlePressable: {
    flex: 1,
    minWidth: 0,
  },
  exerciseHeaderTextStack: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xxs,
  },
  exerciseTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  collapseChevronText: {
    fontSize: 16,
    color: uiColors.textMuted,
  },
  setList: {
    gap: uiSpace.sm,
  },
});
