import { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import {
  uiBorder,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui/tokens';
import type { SessionSetTypeValue } from '@/src/data/set-types';
import {
  canCommitLogger,
  formatEffort,
  formatOneRepMax,
  formatVolume,
  previewMetrics,
} from '@/src/session-recorder/exercise-page-model';

import { pageText } from './text-styles';

type SetLoggerProps = {
  number: number;
  weightValue: string;
  repsValue: string;
  setType: SessionSetTypeValue;
  onChangeWeight: (value: string) => void;
  onChangeReps: (value: string) => void;
  onCycleEffort: () => void;
  onOpenEffort: () => void;
  onCommit: () => void;
};

// Up to 5 digits and a point; the logger rejects anything else as it is typed.
const isWeightInput = (text: string) => /^\d*\.?\d*$/.test(text) && text.replace('.', '').length <= 5;
const REPS_PATTERN = /^\d{0,2}$/;

const DASH = '—';

/**
 * The open set, expanded in place into the logger (`ux-rules` §14a.3):
 * Weight · Reps · Effort · the commit tick, all fields one height.
 * The tick is the screen's one `accent` primary; it is disabled until the
 * values are a valid set.
 */
export const SetLogger = forwardRef<TextInput, SetLoggerProps>(function SetLogger(
  { number, weightValue, repsValue, setType, onChangeWeight, onChangeReps, onCycleEffort, onOpenEffort, onCommit },
  weightInputRef
) {
  const { oneRepMax, volume } = previewMetrics(weightValue, repsValue);
  const canCommit = canCommitLogger({ weightValue, repsValue });
  const effort = formatEffort(setType);

  return (
    <View style={styles.logger} testID="exercise-set-logger">
      <View style={styles.header}>
        <Text allowFontScaling={false} style={[pageText.microLabel, styles.setLabel]}>{`Set ${number}`}</Text>
        <Text allowFontScaling={false} style={pageText.detailFigure} testID="exercise-set-logger-preview">
          {`1RM ${oneRepMax !== null ? formatOneRepMax(oneRepMax) : DASH} · VOL ${volume !== null ? formatVolume(volume) : DASH}`}
        </Text>
      </View>
      <View style={styles.fields}>
        <View style={[styles.field, styles.weightField]}>
          <Text allowFontScaling={false} style={pageText.microLabel}>Weight</Text>
          <TextInput
            allowFontScaling={false}
            accessibilityLabel={`Set ${number} weight`}
            keyboardType="decimal-pad"
            onChangeText={(text) => {
              if (isWeightInput(text)) onChangeWeight(text);
            }}
            ref={weightInputRef}
            selectTextOnFocus
            style={styles.input}
            testID="exercise-set-logger-weight"
            value={weightValue}
          />
        </View>
        <View style={[styles.field, styles.repsField]}>
          <Text allowFontScaling={false} style={pageText.microLabel}>Reps</Text>
          <TextInput
            allowFontScaling={false}
            accessibilityLabel={`Set ${number} reps`}
            keyboardType="number-pad"
            onChangeText={(text) => {
              if (REPS_PATTERN.test(text)) onChangeReps(text);
            }}
            selectTextOnFocus
            style={styles.input}
            testID="exercise-set-logger-reps"
            value={repsValue}
          />
        </View>
        <Pressable
          accessibilityLabel={`Change effort, currently ${effort === DASH ? 'none' : effort}`}
          accessibilityRole="button"
          accessibilityHint="Double tap to cycle effort. Long press to choose from all options."
          onPress={onCycleEffort}
          onLongPress={onOpenEffort}
          style={[styles.field, styles.effortField]}
          testID="exercise-set-logger-effort">
          <Text allowFontScaling={false} style={pageText.microLabel}>Effort</Text>
          <View style={styles.effortValue}>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.effortText}>
              {effort}
            </Text>
            <Icon color={uiRoles.inkFaint} name="chevron-down" size="xs" />
          </View>
        </Pressable>
        <View style={styles.control}>
          <Pressable
            accessibilityLabel={`Log set ${number} as performed`}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canCommit }}
            disabled={!canCommit}
            onPress={onCommit}
            style={[styles.tick, canCommit ? null : styles.tickDisabled]}
            testID="exercise-set-logger-commit">
            <Icon color={uiRoles.surface} name="check" />
          </Pressable>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // The row being edited: `accent-wash` ground with an `accent` rule on its
  // leading edge. Rule + padding keep the tick on the list's control axis.
  logger: {
    gap: uiSpace.sm,
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.md,
    paddingLeft: uiSpace.sm,
    paddingRight: uiSpace.md,
    backgroundColor: uiRoles.accentWash,
    borderLeftWidth: uiSpace.xs,
    borderLeftColor: uiRoles.accent,
    borderTopWidth: uiBorder.width,
    borderBottomWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
    borderBottomColor: uiRoles.ruleSoft,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  setLabel: {
    fontWeight: '800',
    color: uiRoles.accent,
  },
  fields: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  field: {
    height: uiGeometry.fieldHeight,
    paddingHorizontal: uiSpace.sm,
    paddingTop: uiSpace.xs,
    backgroundColor: uiRoles.surface,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.control,
  },
  weightField: {
    flex: 1,
  },
  // Two digits of reps; `W-Up` and its caret.
  repsField: {
    width: uiGeometry.fieldHeight,
  },
  effortField: {
    width: uiGeometry.tapTarget * 2,
  },
  input: {
    flex: 1,
    padding: 0,
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxl,
    color: uiRoles.ink,
  },
  effortValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  effortText: {
    flexShrink: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  control: {
    width: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
    borderRadius: uiGeometry.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiRoles.accent,
  },
  tickDisabled: {
    backgroundColor: uiRoles.disabled,
  },
});
