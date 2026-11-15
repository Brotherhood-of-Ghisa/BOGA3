import { forwardRef, type ReactNode } from 'react';
import { Pressable, Text, TextInput, type TextInputInstance, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiBorder, uiGeometry, uiSpace } from '@/components/ui/tokens';
import { formatSessionSetType, type SessionSetTypeValue } from '@/src/data/set-types';
import { formatEffort } from '@/src/session-recorder/exercise-page-model';

type SetEntryFieldsProps = {
  number: number;
  weightValue: string;
  repsValue: string;
  setType: SessionSetTypeValue;
  weightError?: string;
  repsError?: string;
  onChangeWeight: (value: string) => void;
  onChangeReps: (value: string) => void;
  onCycleEffort: () => void;
  onOpenEffort: () => void;
  testID: string;
  children: ReactNode;
};

/** Recorder entry fields reused by plan/programme targets: `Effort`, `Weight`, `Reps`; total-load
 * and per-side share `Weight`, spoken as `Set N weight`. */
export const SetEntryFields = forwardRef<TextInputInstance, SetEntryFieldsProps>(function SetEntryFields(
  { number, weightValue, repsValue, setType, weightError, repsError,
    onChangeWeight, onChangeReps, onCycleEffort, onOpenEffort, testID, children },
  weightInputRef,
) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const effort = formatEffort(setType);
  const effortText = setType === 'technique' || setType === 'cooldown' || setType === 'rehab'
    ? formatSessionSetType(setType, 'compact')
    : effort;

  return (
    <View style={styles.fields}>
      <Pressable
        accessibilityLabel={`Change effort, currently ${effort === '—' ? 'none' : effort}`}
        accessibilityRole="button"
        accessibilityHint="Double tap to cycle effort. Long press to choose from all options."
        onPress={onCycleEffort}
        onLongPress={onOpenEffort}
        style={[styles.field, styles.effortField]}
        testID={`${testID}-effort`}>
        <Text allowFontScaling={false} style={[text.label, tone.faint]}>Effort</Text>
        <View style={styles.effortValue}>
          <Text allowFontScaling={false} numberOfLines={1} style={[text.title, styles.effortText]}>{effortText}</Text>
          <Icon colorRole="inkFaint" name="chevron-down" size="xs" />
        </View>
      </Pressable>
      <View style={[styles.field, styles.weightField, weightError ? styles.invalid : null]}>
        <Text allowFontScaling={false} style={[text.label, tone.faint]}>Weight</Text>
        <TextInput
          allowFontScaling={false}
          accessibilityLabel={`Set ${number} weight`}
          keyboardType="decimal-pad"
          onChangeText={onChangeWeight}
          ref={weightInputRef}
          selectTextOnFocus
          style={[text.figureHero, styles.input]}
          testID={`${testID}-weight`}
          value={weightValue}
        />
      </View>
      <View style={[styles.field, styles.repsField, repsError ? styles.invalid : null]}>
        <Text allowFontScaling={false} style={[text.label, tone.faint]}>Reps</Text>
        <TextInput
          allowFontScaling={false}
          accessibilityLabel={`Set ${number} reps`}
          keyboardType="number-pad"
          onChangeText={onChangeReps}
          selectTextOnFocus
          style={[text.figureHero, styles.input]}
          testID={`${testID}-reps`}
          value={repsValue}
        />
      </View>
      {children}
    </View>
  );
});

const useStyles = makeStyles((roles) => ({
  fields: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
  field: {
    height: uiGeometry.fieldHeight,
    paddingHorizontal: uiSpace.sm,
    paddingTop: uiSpace.xs,
    backgroundColor: roles.surface,
    borderWidth: uiBorder.width,
    borderColor: roles.rule,
    borderRadius: uiGeometry.radius.control,
  },
  invalid: { borderColor: roles.danger },
  effortField: { width: uiGeometry.tapTarget * 2 },
  weightField: { flex: 1, maxWidth: uiGeometry.tapTarget * 2 + uiSpace.xl },
  repsField: { width: uiGeometry.fieldHeight + uiSpace.md },
  input: {
    flex: 1,
    padding: 0,
  },
  effortValue: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: uiSpace.xs },
  effortText: { flexShrink: 1 },
}));
