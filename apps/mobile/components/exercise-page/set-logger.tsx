import { formatOneRepMax, formatVolume } from '@/src/exercise-calculations/format';
import { forwardRef } from 'react';
import { Pressable, Text, type TextInputInstance, View } from 'react-native';

import type { LoadContext } from '@/src/exercise-calculations/load-metrics';
import { canonicalizeWeightForReps } from '@/src/exercise-calculations/set-semantics';
import { FigureText } from '@/components/ui/figure-text';
import { Icon } from '@/components/ui/icon';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import {
  uiBorder,
  uiGeometry,
  uiSpace,
} from '@/components/ui/tokens';
import type { SessionSetTypeValue } from '@/src/data/set-types';
import {
  canCommitLogger,
  previewMetrics,
} from '@/src/session-recorder/exercise-page-model';

import { SetEntryFields } from './set-entry-fields';

type SetLoggerProps = {
  loadContext: LoadContext;
  number: number;
  weightValue: string;
  repsValue: string;
  setType: SessionSetTypeValue;
  onChangeWeight: (value: string) => void;
  onChangeReps: (value: string) => void;
  onCycleEffort: () => void;
  onOpenEffort: () => void;
  onCommit: () => void;
  // The swipe-right equivalent, as the logger's `confirm` accessibility
  // action (`ux-rules.md` "Swipes on the exercise page"):
  // the tick confirms without the swipe's last-set add-set continuation. Absent when the values are not a valid set.
  onConfirm?: () => void;
  // The swipe-left equivalent, as the logger's `discard` accessibility action.
  // Offered for any row the page holds.
  onDrop?: () => void;
};

// Permit partial decimal entry; the shared parser validates finite load on commit.
const isWeightInput = (text: string) => /^\d*\.?\d*$/.test(text);
const REPS_PATTERN = /^\d{0,3}$/;

const DASH = '—';

const actionsHint = (canConfirm: boolean, canDrop: boolean): string | undefined => {
  if (canConfirm && canDrop) return 'Confirm or drop the set from the actions menu';
  if (canConfirm) return 'Confirm the set from the actions menu';
  return canDrop ? 'Drop the set from the actions menu' : undefined;
};

/**
 * The open set, expanded in place into the logger (spec 08,
 * "In-place row logger pattern"):
 * Effort · Weight · Reps · the commit tick, all fields one height.
 * The Effort control leads the row, aligned to the set viewer's effort column;
 * it is followed by the narrower weight input, reps, and the commit tick. The
 * tick is the screen's one `accent` primary; it is disabled until the
 * values are a valid set.
 */
export const SetLogger = forwardRef<TextInputInstance, SetLoggerProps>(function SetLogger(
  { number, weightValue, repsValue, setType, onChangeWeight, onChangeReps, onCycleEffort, onOpenEffort, onCommit, onConfirm, onDrop, loadContext },
  weightInputRef
) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const canonicalWeight = canonicalizeWeightForReps(weightValue, repsValue);
  const { oneRepMax, volume } = previewMetrics(canonicalWeight, repsValue, loadContext);
  const canCommit = canCommitLogger({ weightValue, repsValue });

  return (
    <View style={styles.logger} testID="exercise-set-logger">
      <View
        accessibilityActions={[
          ...(onConfirm ? [{ name: 'confirm', label: `Confirm set ${number}` }] : []),
          ...(onDrop ? [{ name: 'discard', label: `Drop set ${number}` }] : []),
        ]}
        accessibilityHint={actionsHint(onConfirm !== undefined, onDrop !== undefined)}
        accessibilityLabel={`Set ${number}, in progress`}
        accessible
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'confirm') onConfirm?.();
          if (event.nativeEvent.actionName === 'discard') onDrop?.();
        }}
        style={styles.header}
        testID="exercise-set-logger-header">
        <Text allowFontScaling={false} style={[text.label, tone.accent]}>{`Set ${number}`}</Text>
        <Text allowFontScaling={false} style={text.meta} testID="exercise-set-logger-preview">
          <FigureText>{`1RM ${oneRepMax !== null ? formatOneRepMax(oneRepMax) : DASH} · VOL ${volume !== null ? formatVolume(volume) : DASH}`}</FigureText>
        </Text>
      </View>
      <SetEntryFields
        number={number}
        weightValue={weightValue}
        repsValue={repsValue}
        setType={setType}
        onChangeWeight={(value) => { if (isWeightInput(value)) onChangeWeight(value); }}
        onChangeReps={(value) => { if (REPS_PATTERN.test(value)) onChangeReps(value); }}
        onCycleEffort={onCycleEffort}
        onOpenEffort={onOpenEffort}
        ref={weightInputRef}
        testID="exercise-set-logger">
        <View style={styles.control}>
          <Pressable
            accessibilityLabel={`Log set ${number} as performed`}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canCommit }}
            disabled={!canCommit}
            onPress={onCommit}
            style={[styles.tick, canCommit ? null : styles.tickDisabled]}
            testID="exercise-set-logger-commit">
            <Icon colorRole="onAccent" name="check" />
          </Pressable>
        </View>
      </SetEntryFields>
    </View>
  );
});

const useStyles = makeStyles((roles) => ({
  // The row being edited: `accent-wash` ground with an `accent` rule on its
  // leading edge. Rule + padding keep the tick on the list's control axis.
  logger: {
    gap: uiSpace.sm,
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.md,
    paddingLeft: uiSpace.sm,
    paddingRight: uiSpace.md,
    backgroundColor: roles.accentWash,
    borderLeftWidth: uiSpace.xs,
    borderLeftColor: roles.accent,
    borderTopWidth: uiBorder.width,
    borderBottomWidth: uiBorder.width,
    borderTopColor: roles.ruleSoft,
    borderBottomColor: roles.ruleSoft,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Pinned to the trailing edge so the tick keeps the list's control axis.
  control: {
    width: uiGeometry.tapTarget,
    marginLeft: 'auto',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
    borderRadius: uiGeometry.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: roles.accent,
  },
  tickDisabled: {
    backgroundColor: roles.inkGhost,
  },
}));
