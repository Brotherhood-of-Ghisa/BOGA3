import { Fragment, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { UiSurface, UiText, uiSpace } from '@/components/ui';

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

          return (
            <UiSurface
              key={exercise.id}
              {...exerciseCardProps}
              style={[styles.exerciseCard, exerciseCardProps?.style]}>
              <View style={styles.exerciseCardHeader}>
                <View style={styles.exerciseHeaderTextStack}>
                  <UiText
                    adjustsFontSizeToFit
                    ellipsizeMode="clip"
                    minimumFontScale={0.82}
                    numberOfLines={2}
                    variant="title">
                    {exercise.name || `Exercise ${exerciseIndex + 1}`}
                  </UiText>
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
                </View>
                {renderExerciseHeaderAction ? renderExerciseHeaderAction({ exercise, exerciseIndex }) : null}
              </View>

              {renderExerciseMeta ? renderExerciseMeta({ exercise, exerciseIndex }) : null}

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

              {renderExerciseFooter ? renderExerciseFooter({ exercise, exerciseIndex }) : null}
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
  exerciseHeaderTextStack: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xxs,
  },
  setList: {
    gap: uiSpace.sm,
  },
});
