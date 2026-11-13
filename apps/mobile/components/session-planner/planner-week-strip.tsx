import { useDateFormat } from '@/src/preferences/hooks';
import type { PlanSummaryView } from '@/src/session-planner';
import { localWeekWindow } from '@/src/utils/local-calendar';
import { localDateKey } from '@/src/utils/calendar-weeks';
import { formatCompactDateRange, formatDayMonth } from '@/src/utils/local-time';
import { Pressable, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiBorder, uiGeometry, uiSpace } from '@/components/ui/tokens';

export type PlannerWeekStripProps = {
  plans: PlanSummaryView[];
  selectedDate: string | null;
  onSelectDate: (dateKey: string | null) => void;
  testID?: string;
};

const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/**
 * Interactive 7-day strip (Monday–Sunday) showing scheduled session markers,
 * today indicator, and single-day filtering for the planner agenda.
 */
export function PlannerWeekStrip({
  plans,
  selectedDate,
  onSelectDate,
  testID = 'planner-week-strip',
}: PlannerWeekStripProps) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const dateFormat = useDateFormat();

  const now = new Date();
  const weekWindow = localWeekWindow(now);
  const weekEnd = new Date(weekWindow.start.getFullYear(), weekWindow.start.getMonth(), weekWindow.start.getDate() + 6);
  const weekRangeLabel = formatCompactDateRange(weekWindow.start, weekEnd, dateFormat);

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekWindow.start.getFullYear(), weekWindow.start.getMonth(), weekWindow.start.getDate() + i);
    const key = localDateKey(date);
    const count = plans.filter((plan) => plan.scheduledFor && localDateKey(plan.scheduledFor) === key).length;
    return {
      date,
      key,
      dayNumber: date.getDate(),
      dayInitial: DAY_INITIALS[i],
      isToday: localDateKey(date) === localDateKey(now),
      isSelected: selectedDate === key,
      count,
    };
  });

  return (
    <Card style={styles.card} testID={testID}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text allowFontScaling={false} style={[text.label, tone.faint]}>
            THIS WEEK
          </Text>
          <Text allowFontScaling={false} style={[text.meta, tone.muted]}>
            {weekRangeLabel}
          </Text>
        </View>
        {selectedDate ? (
            <Pressable
              accessibilityLabel="Show all upcoming workouts"
              accessibilityRole="button"
              hitSlop={uiSpace.sm}
              onPress={() => onSelectDate(null)}
              testID={`${testID}-clear`}>
              <Text allowFontScaling={false} style={[text.label, tone.accent]}>
                All dates
              </Text>
            </Pressable>
        ) : null}
      </View>
      <View style={styles.daysRow} testID={`${testID}-days`}>
        {days.map((day) => {
          const accessibility = `${day.dayInitial}, ${formatDayMonth(day.date, dateFormat)}${
            day.isToday ? ', Today' : ''
          }${day.count > 0 ? `, ${day.count} planned` : ', no workouts'}${
            day.isSelected ? ', selected' : ''
          }`;
          return (
            <Pressable
              accessibilityLabel={accessibility}
              accessibilityRole="button"
              accessibilityState={{ selected: day.isSelected }}
              key={day.key}
              onPress={() => onSelectDate(day.isSelected ? null : day.key)}
              style={[
                styles.dayTile,
                day.isToday && !day.isSelected ? styles.dayToday : null,
                day.isSelected ? styles.daySelected : null,
              ]}
              testID={`${testID}-day-${day.key}`}>
              <Text
                allowFontScaling={false}
                style={[
                  text.meta,
                  day.isSelected ? styles.textOnSelected : tone.faint,
                ]}>
                {day.dayInitial}
              </Text>
              <Text
                allowFontScaling={false}
                style={[
                  text.bodyStrong,
                  day.isSelected ? styles.textOnSelected : null,
                  day.isToday && !day.isSelected ? tone.accent : null,
                ]}>
                {day.dayNumber}
              </Text>
              <View style={styles.dotContainer}>
                {day.count > 0 ? (
                  <View
                    style={[
                      styles.dot,
                      day.isSelected ? styles.dotOnSelected : styles.dotActive,
                    ]}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

const useStyles = makeStyles((roles) => ({
  card: {
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.xs,
  },
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: uiSpace.xs,
  },
  dayTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: uiSpace.xs,
    borderRadius: uiGeometry.radius.control,
    gap: uiSpace.xs,
  },
  dayToday: {
    borderWidth: uiBorder.width,
    borderColor: roles.rule,
  },
  daySelected: {
    backgroundColor: roles.ink,
  },
  textOnSelected: {
    color: roles.onInk,
  },
  dotContainer: {
    height: uiSpace.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    width: uiSpace.xs,
    height: uiSpace.xs,
    borderRadius: uiGeometry.radius.pill,
  },
  dotActive: {
    backgroundColor: roles.accent,
  },
  dotOnSelected: {
    backgroundColor: roles.onInk,
  },
}));
