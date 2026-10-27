import { StyleSheet, Text, View } from 'react-native';

import { LAST_WEEK, WeekFigure, weekFigureStyles, type PreviousWeekName } from '@/components/today/week-figures';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiSpace } from '@/components/ui/tokens';
import type { GroupWeekTotals } from '@/src/groups/home-view-model';

const WEEK_BEFORE: PreviousWeekName = { short: 'wk before', spoken: 'the week before' };

export type GroupWeekTotalsProps = {
  current: GroupWeekTotals;
  previous: GroupWeekTotals;
  /** The stepper's offset for the week drawn: 0 compares with last week, earlier ones with the week before. */
  offset: number;
};

/**
 * The whole group's week, as Today's week figures draw one person's: working
 * sets and group records against the week before, each filling a bar in laps
 * of that week's total.
 */
export function GroupWeekTotalsFigures({ current, previous, offset }: GroupWeekTotalsProps) {
  const previousWeek = offset === 0 ? LAST_WEEK : WEEK_BEFORE;
  return (
    <View style={styles.block} testID="group-week-totals">
      <Text allowFontScaling={false} style={[uiText.label, uiTextTone.ink]}>
        Group total
      </Text>
      <View style={weekFigureStyles.figures}>
        <WeekFigure
          current={current.sets}
          label="Sets"
          previous={previous.sets}
          previousWeek={previousWeek}
          testID="group-week-totals-sets"
        />
        <WeekFigure
          current={current.prs}
          label="PRs"
          previous={previous.prs}
          previousWeek={previousWeek}
          record
          testID="group-week-totals-prs"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: uiSpace.md,
  },
});
