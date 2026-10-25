import { forwardRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, type TextInputInstance, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { formatSessionSetType, type SessionSetTypeValue } from '@/src/data/set-types';
import { formatEffort } from '@/src/session-recorder/exercise-page-model';

import { pageText } from './text-styles';

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
  const effort = formatEffort(setType);
  const effortText = setType === 'technique' || setType === 'cooldown'
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
        <Text allowFontScaling={false} style={pageText.microLabel}>Effort</Text>
        <View style={styles.effortValue}>
          <Text allowFontScaling={false} numberOfLines={1} style={styles.effortText}>{effortText}</Text>
          <Icon color={uiRoles.inkFaint} name="chevron-down" size="xs" />
        </View>
      </Pressable>
      <View style={[styles.field, styles.weightField, weightError ? styles.invalid : null]}>
        <Text allowFontScaling={false} style={pageText.microLabel}>Weight</Text>
        <TextInput
          allowFontScaling={false}
          accessibilityLabel={`Set ${number} weight`}
          keyboardType="decimal-pad"
          onChangeText={onChangeWeight}
          ref={weightInputRef}
          selectTextOnFocus
          style={styles.input}
          testID={`${testID}-weight`}
          value={weightValue}
        />
      </View>
      <View style={[styles.field, styles.repsField, repsError ? styles.invalid : null]}>
        <Text allowFontScaling={false} style={pageText.microLabel}>Reps</Text>
        <TextInput
          allowFontScaling={false}
          accessibilityLabel={`Set ${number} reps`}
          keyboardType="number-pad"
          onChangeText={onChangeReps}
          selectTextOnFocus
          style={styles.input}
          testID={`${testID}-reps`}
          value={repsValue}
        />
      </View>
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  fields: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
  field: {
    height: uiGeometry.fieldHeight,
    paddingHorizontal: uiSpace.sm,
    paddingTop: uiSpace.xs,
    backgroundColor: uiRoles.surface,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.control,
  },
  invalid: { borderColor: uiRoles.danger },
  effortField: { width: uiGeometry.tapTarget * 2 },
  weightField: { flex: 1, maxWidth: uiGeometry.tapTarget * 2 + uiSpace.xl },
  repsField: { width: uiGeometry.fieldHeight + uiSpace.md },
  input: {
    flex: 1,
    padding: 0,
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxl,
    color: uiRoles.ink,
  },
  effortValue: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: uiSpace.xs },
  effortText: {
    flexShrink: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
});
