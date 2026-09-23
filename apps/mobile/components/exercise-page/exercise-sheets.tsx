import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { uiRoles } from '@/components/ui/tokens';
import type { SessionSetTypeValue } from '@/src/data/set-types';
import { EFFORT_OPTIONS, formatEffort } from '@/src/session-recorder/exercise-page-model';

type EffortSheetProps = {
  visible: boolean;
  selected: SessionSetTypeValue;
  onSelect: (setType: SessionSetTypeValue) => void;
  onDismiss: () => void;
};

// Four efforts, the current one marked. Only opened when deviating from the
// planned effort the logger already defaults to (build spec, "Sheets").
export function EffortSheet({ visible, selected, onSelect, onDismiss }: EffortSheetProps) {
  return (
    <Sheet
      dismissLabel="Dismiss effort picker"
      onDismiss={onDismiss}
      testID="exercise-effort-sheet"
      title="Effort"
      visible={visible}>
      {EFFORT_OPTIONS.map((option) => {
        const isSelected = option === selected;
        return (
          <ListRow
            key={option}
            label={formatEffort(option)}
            onPress={() => onSelect(option)}
            selected={isSelected}
            testID={`exercise-effort-option-${option}`}
            trailing={isSelected ? <Icon color={uiRoles.accent} name="check" /> : undefined}
          />
        );
      })}
    </Sheet>
  );
}

type ExerciseOptionsSheetProps = {
  visible: boolean;
  exerciseName: string;
  onEdit: () => void;
  onSwap: () => void;
  onRemove: () => void;
  onDismiss: () => void;
};

// The exercise's ⋮: Edit / Swap / Remove from session. Removing lives here,
// not on the session view's card (build spec, "Session view").
export function ExerciseOptionsSheet({
  visible,
  exerciseName,
  onEdit,
  onSwap,
  onRemove,
  onDismiss,
}: ExerciseOptionsSheetProps) {
  return (
    <Sheet
      dismissLabel="Dismiss options"
      onDismiss={onDismiss}
      testID="exercise-options-sheet"
      title={exerciseName}
      visible={visible}>
      <ListRow
        label="Edit exercise"
        leading={<Icon color={uiRoles.ink} name="pencil" />}
        onPress={onEdit}
        testID="exercise-options-edit"
      />
      <ListRow
        label="Swap exercise"
        leading={<Icon color={uiRoles.ink} name="swap" />}
        onPress={onSwap}
        testID="exercise-options-swap"
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
