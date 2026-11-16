import { useDateFormat } from '@/src/preferences/hooks';
import { ScrollView, Text, View } from 'react-native';

import { SetSummaryRow } from '@/components/session-detail/set-summary-row';
import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { FigureText } from '@/components/ui/figure-text';
import { useUiText } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiBorder, uiSpace, uiTypography } from '@/components/ui/tokens';
import { canonicalizeWeightForReps } from '@/src/exercise-calculations/set-semantics';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { formatLocalDateTime } from '@/src/utils/local-time';
import { formatSetRow } from '@/src/session-recorder/session-view-model';
import type { ExercisePickerPreselectionState } from '@/components/session-recorder/types';

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
  const dateFormat = useDateFormat();
  const styles = useStyles();
  const text = useUiText();
  return (
    <Card testID="exercise-picker-preselection-panel">
      <Text allowFontScaling={false} style={[text.title, styles.preselectionTitle]}>
        <FigureText strong>{state.exercise.name}</FigureText>
      </Text>
      {/* The preview keeps one height in every state, so the actions below
          never move when the last workout arrives. */}
      <View style={styles.plan} testID="exercise-picker-plan-area">
        {state.suggestion ? (
          <>
            <Text allowFontScaling={false} numberOfLines={1} style={text.label} testID="exercise-picker-plan-source">
              <FigureText>{`From ${formatLocalDateTime(state.suggestion.completedAt.getTime(), dateFormat)}`}</FigureText>
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
          </>
        ) : (
          <Text allowFontScaling={false} numberOfLines={1} style={text.label} testID="exercise-picker-plan-status">
            {PLAN_STATUS_TEXT[state.status]}
          </Text>
        )}
      </View>
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
            label={state.status === 'loading' ? 'Loading...' : 'Repeat last'}
            onPress={onRepeat}
            testID="exercise-picker-repeat-last-button"
            variant="primary"
          />
        </View>
      </View>
    </Card>
  );
}

// The source line plus the rows' scroll area: one height whether the plan is
// loading, short, long, absent or failed.
const PLAN_AREA_HEIGHT = 238 + uiTypography.lineHeight.xxs + uiSpace.xs + uiSpace.md;

// Without a suggestion the preview area says why; it still holds its height.
const PLAN_STATUS_TEXT: Record<ExercisePickerPreselectionState['status'], string> = {
  loading: 'Loading last workout...',
  ready: 'No earlier workout to repeat.',
  error: "Couldn't load the last workout.",
};

const useStyles = makeStyles((roles) => ({
  preselectionTitle: {
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.md,
    paddingBottom: uiSpace.sm,
  },
  plan: {
    height: PLAN_AREA_HEIGHT,
    gap: uiSpace.xs,
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.md,
  },
  // Long plans scroll inside the card; the actions stay in view.
  planRowList: {
    flex: 1,
  },
  planRows: {
    gap: uiSpace.xs,
  },
  // The card's action strip.
  actions: {
    flexDirection: 'row',
    gap: uiSpace.sm,
    padding: uiSpace.md,
    backgroundColor: roles.paper,
    borderTopWidth: uiBorder.width,
    borderTopColor: roles.ruleSoft,
  },
  action: {
    flex: 1,
  },
}));
