import { StyleSheet, Text, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiSpace } from '@/components/ui/tokens';
import type { GroupHomePeriod } from '@/src/groups/home-periods';

export type GroupHomeStepperProps = {
  /** The week: `This week`, `Last week`, or its dates. */
  label: string;
  period: GroupHomePeriod;
  /** Steps one period back; there is always an earlier one. */
  onEarlier: () => void;
  /** Steps one period forward; off at the period in progress. */
  onLater: () => void;
  canGoLater: boolean;
};

/**
 * The period stepper, one line beside the metric: the week the cards below
 * are reading, between the chevrons that walk backwards and
 * forwards through the weeks.
 */
export function GroupHomeStepper({ label, onEarlier, onLater, canGoLater }: GroupHomeStepperProps) {
  const noun = 'week';
  return (
    <View style={styles.stepper} testID="group-home-period-stepper">
      <IconButton
        accessibilityLabel={`Previous ${noun}`}
        name="chevron-left"
        onPress={onEarlier}
        testID="group-home-period-earlier"
        tone="muted"
      />
      <Text
        adjustsFontSizeToFit
        allowFontScaling={false}
        minimumFontScale={0.8}
        numberOfLines={1}
        style={[uiText.label, uiTextTone.ink, styles.stepperLabel]}
        testID="group-home-period-title">
        {label}
      </Text>
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
    gap: uiSpace.xs,
  },
  stepperLabel: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
  },
});
