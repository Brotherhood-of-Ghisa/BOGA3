import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { SetSummaryRow } from '@/components/session-detail/set-summary-row';
import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { canonicalizeWeightForReps } from '@/src/exercise-calculations/set-semantics';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { formatCurrentDateTime } from '@/src/utils/local-time';
import { formatSetRow } from '@/src/session-recorder/session-view-model';
import type { ExercisePickerPreselectionState } from '@/components/session-recorder/exercise-picker';

export type PickerPreselectionCardProps = {
  state: ExercisePickerPreselectionState;
  /** Repeat last stays disabled until a valid historical plan is ready. */
  repeatDisabled: boolean;
  onAddEmptySet: () => void;
  onRepeat: () => void;
};

/**
 * The picker's preselection card: the picked exercise, its historical plan
 * preview (the last session's sets), and the two add actions — Add empty
 * set and Repeat last, the card's one `accent`.
 */
export function PickerPreselectionCard({ state, repeatDisabled, onAddEmptySet, onRepeat }: PickerPreselectionCardProps) {
  return (
    <Card testID="exercise-picker-preselection-panel">
      <Text allowFontScaling={false} style={styles.preselectionTitle}>{state.exercise.name}</Text>
      {state.suggestion ? (
        <View style={styles.plan}>
          <Text allowFontScaling={false} style={styles.planSource} testID="exercise-picker-plan-source">
            From {formatCurrentDateTime(state.suggestion.completedAt)}
          </Text>
          <ScrollView
            contentContainerStyle={styles.planRows}
            nestedScrollEnabled
            style={styles.planRowList}>
            {state.suggestion.sets.map((set, index) => (
              <SetSummaryRow
                key={set.setId}
                row={formatSetRow({
                  id: set.setId,
                  weight: parseSetWeight(canonicalizeWeightForReps(set.weightValue, set.repsValue)),
                  reps: parseSetReps(set.repsValue),
                  setType: set.setType,
                  loadContext: state.suggestion?.loadContext,
                  done: false,
                })}
                testID={`exercise-picker-plan-set-row-${index + 1}`}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
      {/* The card's one `accent`: Repeat last. */}
      <View style={styles.actions}>
        <View style={styles.action}>
          <ActionButton
            accessibilityLabel={`Add empty set for ${state.exercise.name}`}
            label="Add empty set"
            onPress={onAddEmptySet}
            testID="exercise-picker-add-empty-set-button"
            variant="outline"
          />
        </View>
        <View style={styles.action}>
          <ActionButton
            accessibilityLabel={`Repeat last workout for ${state.exercise.name}`}
            disabled={repeatDisabled}
            label="Repeat last"
            onPress={onRepeat}
            testID="exercise-picker-repeat-last-button"
            variant="primary"
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  preselectionTitle: {
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.md,
    paddingBottom: uiSpace.sm,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  plan: {
    gap: uiSpace.xs,
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.md,
  },
  planSource: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  // Long plans scroll inside the card; the actions stay in view.
  planRowList: {
    maxHeight: 238,
  },
  planRows: {
    gap: uiSpace.xs,
  },
  // The card's action strip.
  actions: {
    flexDirection: 'row',
    gap: uiSpace.sm,
    padding: uiSpace.md,
    backgroundColor: uiRoles.paper,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  action: {
    flex: 1,
  },
});
