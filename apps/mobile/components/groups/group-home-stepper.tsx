import { StyleSheet, Text, View } from 'react-native';

import { todayText } from '@/components/today/text-styles';
import { IconButton } from '@/components/ui/icon-button';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { GroupHomePeriod } from '@/src/groups/home-periods';

import type { GroupHomePeriodLabel } from './group-home-labels';

export type GroupHomeStepperProps = {
  label: GroupHomePeriodLabel;
  period: GroupHomePeriod;
  /** Steps one period back; there is always an earlier one. */
  onEarlier: () => void;
  /** Steps one period forward; off at the period in progress. */
  onLater: () => void;
  canGoLater: boolean;
};

/**
 * The period stepper: which week or month the cards below are reading. Which
 * metric, and whether the step is a week or a month, are the screen's filter
 * bar; this only walks backwards and forwards through them.
 */
export function GroupHomeStepper({ label, period, onEarlier, onLater, canGoLater }: GroupHomeStepperProps) {
  const noun = period === 'week' ? 'week' : 'month';
  return (
    <View style={styles.stepper} testID="group-home-period-stepper">
      <IconButton
        accessibilityLabel={`Previous ${noun}`}
        name="chevron-left"
        onPress={onEarlier}
        testID="group-home-period-earlier"
        tone="muted"
      />
      <View style={styles.stepperLabel}>
        <Text allowFontScaling={false} accessibilityRole="header" style={styles.periodTitle} testID="group-home-period-title">
          {label.title}
        </Text>
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelFaint]} testID="group-home-period-detail">
          {label.detail}
        </Text>
      </View>
      <IconButton
        accessibilityLabel={`Next ${noun}`}
        disabled={!canGoLater}
        name="chevron-right"
        onPress={onLater}
        testID="group-home-period-later"
        tone="muted"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    // The chevrons sit on the card's edges, their tap targets paying no inset.
    marginHorizontal: -uiSpace.sm,
  },
  stepperLabel: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  periodTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
});
