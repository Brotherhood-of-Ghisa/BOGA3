import { ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiRoles } from '@/components/ui/tokens';
import { getSessionSetTypeCycle, type SessionSetTypeValue } from '@/src/data/set-types';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { formatEffort } from '@/src/session-recorder/exercise-page-model';
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
            trailing={isSelected ? <Icon color={uiRoles.accent} name="check" /> : undefined}
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
  // Signed in only: opens the Link screen for this exercise (product E0.3).
  onLink?: () => void;
  onRemove: () => void;
  // A card sourced from a plan block: Complete block is its explicit
  // resolution, offered here and nowhere else.
  onCompleteBlock?: () => void;
  onDismiss: () => void;
};

// The exercise's ⋮: Edit / Link to group exercise / Swap / Exercise history /
// Complete block (sourced cards) / Remove from session. Removing lives here, not on the
// session view's card (spec 08, "Read-only link card pattern").
export function ExerciseOptionsSheet({
  visible,
  exerciseName,
  onEdit,
  onSwap,
  onOpenHistory,
  onLink,
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
          leading={<Icon color={uiRoles.ink} name="check" />}
          onPress={onCompleteBlock}
          testID="exercise-options-complete-block"
        />
      ) : null}
      <ListRow
        label="Edit exercise"
        leading={<Icon color={uiRoles.ink} name="pencil" />}
        onPress={onEdit}
        testID="exercise-options-edit"
      />
      {onLink ? (
        <ListRow
          label="Link to group exercise"
          leading={<Icon color={uiRoles.ink} name="link" />}
          onPress={onLink}
          testID="exercise-options-link-group"
        />
      ) : null}
      <ListRow
        label="Swap exercise"
        leading={<Icon color={uiRoles.ink} name="swap" />}
        onPress={onSwap}
        testID="exercise-options-swap"
      />
      <ListRow
        label="Exercise history"
        leading={<Icon color={uiRoles.ink} name="list" />}
        onPress={onOpenHistory}
        testID="exercise-options-history"
      />
      <ListRow
        label="Remove from session"
        leading={<Icon color={uiRoles.danger} name="trash" />}
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
              <Text allowFontScaling={false} style={[uiText.figure, uiTextTone.muted, styles.position]}>
                {row.position}
              </Text>
            }
            meta={
              <Text allowFontScaling={false} style={[uiText.figure, uiTextTone.muted]} testID={`exercise-switcher-progress-${row.id}`}>
                {`${row.doneCount}/${row.totalCount}`}
              </Text>
            }
            onPress={() => onSelect(row.id)}
            selected={row.current}
            testID={`exercise-switcher-row-${row.id}`}
            trailing={isFinished(row) ? <Icon color={uiRoles.inkMuted} name="check" testID={`exercise-switcher-finished-${row.id}`} /> : undefined}
          />
        ))}
      </ScrollView>
      <ListRow
        divider
        label="All exercises (session)"
        leading={<Icon color={uiRoles.ink} name="chevron-left" />}
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
