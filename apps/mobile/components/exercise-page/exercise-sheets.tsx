import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { InjuryEditorSheet } from '@/components/injuries/injury-editor-sheet';
import { InjurySubstitutionSheet } from '@/components/injuries/injury-substitution-sheet';
import { SkipExerciseDialog } from '@/components/injuries/skip-exercise-dialog';
import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { getSessionSetTypeCycle, type SessionSetTypeValue } from '@/src/data/set-types';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { formatEffort } from '@/src/session-recorder/exercise-page-model';
import type { SessionDraftExerciseSnapshot } from '@/src/data/session-drafts';
import { EFFORT_CHOICES } from '@/src/exercise-calculations/effort-policy';
import type { ExerciseSwitcherRow } from '@/src/session-recorder/exercise-switcher';

type EffortSheetProps = {
  visible: boolean;
  selected: SessionSetTypeValue;
  onSelect: (setType: SessionSetTypeValue) => void;
  onDismiss: () => void;
};

// Long-press alternative to cycling, including an explicit blank effort.
export function EffortSheet({ visible, selected, onSelect, onDismiss }: EffortSheetProps) {
  return (
    <Sheet
      dismissLabel="Dismiss effort picker"
      onDismiss={onDismiss}
      testID="exercise-effort-sheet"
      title="Effort"
      visible={visible}>
      <EffortChoices selected={selected} onSelect={onSelect} />
    </Sheet>
  );
}

export function EffortChoices({ selected, onSelect }: Pick<EffortSheetProps, 'selected' | 'onSelect'>) {
  const { height } = useWindowDimensions();
  const { values } = useAccountLocalPreferenceState();
  const options = getSessionSetTypeCycle(values.displayEfforts);
  return (
    <ScrollView style={{ maxHeight: height * 0.65, flexGrow: 0 }}>
      {options.map((option) => {
        const isSelected = option === selected;
        return (
          <ListRow
            key={option ?? 'none'}
            label={EFFORT_CHOICES.find(choice => choice.id === (option ?? 'unspecified'))?.label ?? formatEffort(option)}
            onPress={() => onSelect(option)}
            selected={isSelected}
            testID={`exercise-effort-option-${option ?? 'none'}`}
            trailing={isSelected ? <Icon colorRole="accent" name="check" /> : undefined}
          />
        );
      })}
    </ScrollView>
  );
}

type ExerciseOptionsSheetProps = {
  visible: boolean;
  exerciseName: string;
  onEdit: () => void;
  onSwap: () => void;
  // Opens this exercise's session-by-session history.
  onOpenHistory: () => void;
  // Opens this exercise's training notes.
  onOpenNotes: () => void;
  // Opens the injury / discomfort editor for this exercise's anatomy.
  onReportInjury?: () => void;
  // Signed in only: opens the Link screen for this exercise (product E0.3).
  onLink?: () => void;
  onSkip?: () => void;
  onRemove: () => void;
  // A card sourced from a plan block: Complete block is its explicit
  // resolution, offered here and nowhere else.
  onCompleteBlock?: () => void;
  onDismiss: () => void;
};

// The exercise's ⋮: Edit / Link to group exercise / Swap / Exercise history /
// Notes / Complete block (sourced cards) / Remove from session. Removing lives here, not on the
// session view's card (spec 08, "Read-only link card pattern").
export function ExerciseOptionsSheet({
  visible,
  exerciseName,
  onEdit,
  onSwap,
  onOpenHistory,
  onOpenNotes,
  onReportInjury,
  onLink,
  onSkip,
  onRemove,
  onCompleteBlock,
  onDismiss,
}: ExerciseOptionsSheetProps) {
  return (
    <Sheet
      dismissLabel="Dismiss options"
      onDismiss={onDismiss}
      testID="exercise-options-sheet"
      title={exerciseName}
      visible={visible}>
      {onCompleteBlock ? (
        <ListRow
          label="Complete block"
          leading={<Icon name="check" />}
          onPress={onCompleteBlock}
          testID="exercise-options-complete-block"
        />
      ) : null}
      <ListRow
        label="Edit exercise"
        leading={<Icon name="pencil" />}
        onPress={onEdit}
        testID="exercise-options-edit"
      />
      {onLink ? (
        <ListRow
          label="Link to group exercise"
          leading={<Icon name="link" />}
          onPress={onLink}
          testID="exercise-options-link-group"
        />
      ) : null}
      <ListRow
        label="Swap exercise"
        leading={<Icon name="swap" />}
        onPress={onSwap}
        testID="exercise-options-swap"
      />
      <ListRow
        label="Exercise history"
        leading={<Icon name="list" />}
        onPress={onOpenHistory}
        testID="exercise-options-history"
      />
      <ListRow
        label="Notes"
        leading={<Icon name="notes" />}
        onPress={onOpenNotes}
        testID="exercise-options-notes"
      />
      {onReportInjury ? (
        <ListRow
          label="Log discomfort or injury"
          leading={<Icon colorRole="danger" name="warning" />}
          onPress={onReportInjury}
          testID="exercise-options-report-injury"
        />
      ) : null}
      {onSkip ? (
        <ListRow
          label="Skip exercise"
          leading={<Icon name="x" />}
          onPress={onSkip}
          testID="exercise-options-skip"
        />
      ) : null}
      <ListRow
        label="Remove from session"
        leading={<Icon colorRole="danger" name="trash" />}
        onPress={onRemove}
        testID="exercise-options-remove"
        tone="danger"
      />
    </Sheet>
  );
}

const isFinished = (row: ExerciseSwitcherRow) => row.totalCount > 0 && row.doneCount === row.totalCount;

type ExerciseSwitcherSheetProps = {
  visible: boolean;
  rows: readonly ExerciseSwitcherRow[];
  onSelect: (sessionExerciseId: string) => void;
  // Leaves for the session view, exactly as Back does.
  onOpenSession: () => void;
  onDismiss: () => void;
};

// The title's ▾: the session's exercises in order with their done / total
// sets — the open one highlighted, a finished one ticked — then the way back
// to the whole session.
export function ExerciseSwitcherSheet({ visible, rows, onSelect, onOpenSession, onDismiss }: ExerciseSwitcherSheetProps) {
  const text = useUiText();
  const tone = useUiTextTone();
  const { height } = useWindowDimensions();
  return (
    <Sheet
      dismissLabel="Dismiss exercise switcher"
      onDismiss={onDismiss}
      testID="exercise-switcher-sheet"
      title="Exercises"
      visible={visible}>
      <ScrollView style={{ maxHeight: height * 0.55, flexGrow: 0 }}>
        {rows.map((row) => (
          <ListRow
            accessibilityLabel={`${row.name}, ${row.doneCount} of ${row.totalCount} sets done`}
            key={row.id}
            label={row.name}
            leading={
              <Text allowFontScaling={false} style={[text.figure, tone.muted, styles.position]}>
                {row.position}
              </Text>
            }
            meta={
              <Text allowFontScaling={false} style={[text.figure, tone.muted]} testID={`exercise-switcher-progress-${row.id}`}>
                {`${row.doneCount}/${row.totalCount}`}
              </Text>
            }
            onPress={() => onSelect(row.id)}
            selected={row.current}
            testID={`exercise-switcher-row-${row.id}`}
            trailing={isFinished(row) ? <Icon colorRole="inkMuted" name="check" testID={`exercise-switcher-finished-${row.id}`} /> : undefined}
          />
        ))}
      </ScrollView>
      <ListRow
        divider
        label="All exercises (session)"
        leading={<Icon name="chevron-left" />}
        onPress={onOpenSession}
        testID="exercise-switcher-session"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  position: {
    textAlign: 'center',
  },
});

export type ExerciseInjuryModalsProps = {
  openSheet: 'none' | 'injury' | 'injury-substitution' | 'skip' | string;
  setOpenSheet: (sheet: any) => void;
  exercise: SessionDraftExerciseSnapshot;
  editingExercise?: ExerciseCatalogExercise | null;
  onSwapExercise: (picked: { id: string; name: string }) => void;
  onPerformSkip: (reason?: string) => void;
};

export function ExerciseInjuryModals({
  openSheet,
  setOpenSheet,
  exercise,
  editingExercise,
  onSwapExercise,
  onPerformSkip,
}: ExerciseInjuryModalsProps) {
  const [pendingSkipAfterInjury, setPendingSkipAfterInjury] = useState(false);

  const performSkip = useCallback(
    (reason?: string) => {
      setOpenSheet('none');
      onPerformSkip(reason);
    },
    [onPerformSkip, setOpenSheet]
  );

  const initialMuscleGroupId =
    editingExercise?.mappings.find((m) => m.role === 'primary')?.muscleGroupId ??
    editingExercise?.mappings[0]?.muscleGroupId ??
    null;

  const handleInjuryDismiss = useCallback(() => {
    setOpenSheet('none');
    if (pendingSkipAfterInjury) {
      setPendingSkipAfterInjury(false);
      performSkip('discomfort');
    }
  }, [pendingSkipAfterInjury, performSkip, setOpenSheet]);

  const handleInjurySaved = useCallback(() => {
    if (pendingSkipAfterInjury) {
      setPendingSkipAfterInjury(false);
      performSkip('discomfort');
    }
  }, [pendingSkipAfterInjury, performSkip]);

  const handleConfirmSkip = useCallback(
    (reason: string) => {
      if (reason === 'discomfort') {
        setPendingSkipAfterInjury(true);
        setOpenSheet('injury');
      } else {
        performSkip(reason);
      }
    },
    [performSkip, setOpenSheet]
  );

  return (
    <>
      <InjuryEditorSheet
        initialLabel={exercise.name}
        initialMuscleGroupId={initialMuscleGroupId}
        onDismiss={handleInjuryDismiss}
        onSaved={handleInjurySaved}
        testID="exercise-page-injury-sheet"
        visible={openSheet === 'injury'}
      />
      <InjurySubstitutionSheet
        currentExercise={{
          id: exercise.exerciseDefinitionId,
          name: exercise.name,
          mappings: editingExercise?.mappings,
        }}
        onDismiss={() => setOpenSheet('none')}
        onOpenFullCatalogue={() => setOpenSheet('swap')}
        onSelect={(picked) => {
          setOpenSheet('none');
          onSwapExercise(picked);
        }}
        testID="exercise-page-injury-substitution-sheet"
        visible={openSheet === 'injury-substitution'}
      />
      <SkipExerciseDialog
        exerciseName={exercise.name}
        onConfirmSkip={handleConfirmSkip}
        onDismiss={() => setOpenSheet('none')}
        testID="exercise-page-skip-dialog"
        visible={openSheet === 'skip'}
      />
    </>
  );
}

