import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { UiText, uiBorder, uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
import type { SelectedMuscleDailyEffort } from '@/src/data';

export const CALENDAR_HEATMAP_WEEKDAY_LABELS = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_VISIBLE_WEEK_COUNT = 8;
const CELL_SIZE = 34;
const ROW_GAP = uiSpace.xs;
const COLUMN_GAP = uiSpace.xs;

export type CalendarHeatmapBucket = 0 | 1 | 2 | 3 | 4;

export type CalendarHeatmapCell = {
  dateKey: string;
  dailyEffort: SelectedMuscleDailyEffort | null;
  totalWeight: number;
  bucket: CalendarHeatmapBucket;
  isToday: boolean;
  isSelected: boolean;
};

export type CalendarHeatmapWeek = {
  weekStartDateKey: string;
  cells: CalendarHeatmapCell[];
};

export type BuildCalendarHeatmapWeeksOptions = {
  latestDateKey?: string;
  minimumWeekCount?: number;
  selectedDateKey?: string | null;
  todayDateKey?: string;
};

export type CalendarHeatmapProps = {
  dailyEffort: SelectedMuscleDailyEffort[];
  selectedDateKey?: string | null;
  todayDateKey?: string;
  visibleWeekCount?: number;
  onSelectDate?: (cell: CalendarHeatmapCell) => void;
  testID?: string;
};

export const getCurrentLocalDateKey = () => {
  const now = new Date();
  const year = now.getFullYear().toString().padStart(4, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getCalendarHeatmapBucket = (
  totalWeight: number,
  maxPositiveWeight: number
): CalendarHeatmapBucket => {
  if (totalWeight <= 0 || maxPositiveWeight <= 0) return 0;

  const ratio = totalWeight / maxPositiveWeight;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
};

export const buildCalendarHeatmapWeeks = (
  dailyEffort: SelectedMuscleDailyEffort[],
  options: BuildCalendarHeatmapWeeksOptions = {}
): CalendarHeatmapWeek[] => {
  const todayDateKey = options.todayDateKey ?? getCurrentLocalDateKey();
  const minimumWeekCount = options.minimumWeekCount ?? DEFAULT_VISIBLE_WEEK_COUNT;
  const effortByDate = new Map(dailyEffort.map((entry) => [entry.dateKey, entry]));
  const maxPositiveWeight = dailyEffort.reduce(
    (max, entry) => Math.max(max, entry.totalWeight > 0 ? entry.totalWeight : 0),
    0
  );
  const relevantDateKeys = [
    todayDateKey,
    options.latestDateKey,
    options.selectedDateKey ?? undefined,
    ...dailyEffort.map((entry) => entry.dateKey),
  ].filter((dateKey): dateKey is string => Boolean(dateKey));

  const latestDateKey = relevantDateKeys.reduce((latest, dateKey) =>
    compareDateKeys(dateKey, latest) > 0 ? dateKey : latest
  );
  const earliestDateKey = relevantDateKeys.reduce((earliest, dateKey) =>
    compareDateKeys(dateKey, earliest) < 0 ? dateKey : earliest
  );
  const latestWeekStart = startOfMondayWeek(dateKeyToUtcDate(latestDateKey));
  const earliestWeekStart = startOfMondayWeek(dateKeyToUtcDate(earliestDateKey));
  const loadedWeekCount =
    Math.floor((latestWeekStart.getTime() - earliestWeekStart.getTime()) / (MS_PER_DAY * 7)) + 1;
  const weekCount = Math.max(minimumWeekCount, loadedWeekCount);

  return Array.from({ length: weekCount }, (_, weekIndex) => {
    const weekStart = addDays(latestWeekStart, weekIndex * -7);
    const weekStartDateKey = formatUtcDateKey(weekStart);
    const cells = Array.from({ length: 7 }, (_unused, dayIndex) => {
      const dateKey = formatUtcDateKey(addDays(weekStart, dayIndex));
      const entry = effortByDate.get(dateKey) ?? null;
      const totalWeight = entry?.totalWeight ?? 0;

      return {
        dateKey,
        dailyEffort: entry,
        totalWeight,
        bucket: getCalendarHeatmapBucket(totalWeight, maxPositiveWeight),
        isToday: dateKey === todayDateKey,
        isSelected: dateKey === options.selectedDateKey,
      };
    });

    return { weekStartDateKey, cells };
  });
};

export function CalendarHeatmap({
  dailyEffort,
  selectedDateKey = null,
  todayDateKey,
  visibleWeekCount = DEFAULT_VISIBLE_WEEK_COUNT,
  onSelectDate,
  testID = 'calendar-heatmap',
}: CalendarHeatmapProps) {
  const resolvedTodayDateKey = todayDateKey ?? getCurrentLocalDateKey();
  const weeks = buildCalendarHeatmapWeeks(dailyEffort, {
    minimumWeekCount: visibleWeekCount,
    selectedDateKey,
    todayDateKey: resolvedTodayDateKey,
  });

  return (
    <View style={styles.container} testID={testID}>
      <View accessibilityRole="text" style={styles.weekdayRow} testID={`${testID}-weekday-row`}>
        {CALENDAR_HEATMAP_WEEKDAY_LABELS.map((label) => (
          <UiText key={label} style={styles.weekdayLabel} variant="subtitle">
            {label}
          </UiText>
        ))}
      </View>
      <ScrollView
        style={[styles.weekViewport, { maxHeight: getVisibleGridHeight(visibleWeekCount) }]}
        contentContainerStyle={styles.weekList}
        showsVerticalScrollIndicator={false}
        testID={`${testID}-scroll`}>
        {weeks.map((week, weekIndex) => (
          <View
            key={week.weekStartDateKey}
            style={styles.weekRow}
            testID={`${testID}-week-row-${weekIndex}`}>
            {week.cells.map((cell) => (
              <Pressable
                accessibilityHint="Select this date"
                accessibilityLabel={buildCellAccessibilityLabel(cell)}
                accessibilityRole="button"
                accessibilityState={{ selected: cell.isSelected }}
                key={cell.dateKey}
                onPress={() => onSelectDate?.(cell)}
                style={[
                  styles.cell,
                  bucketStyles[cell.bucket],
                  cell.isToday && cell.bucket === 0 ? styles.todayNeutralCell : null,
                  cell.isToday ? styles.todayCell : null,
                  cell.isSelected ? styles.selectedCell : null,
                ]}
                testID={`${testID}-cell-${cell.dateKey}`}>
                {cell.isToday ? (
                  <View
                    style={styles.todayMarker}
                    testID={`${testID}-cell-${cell.dateKey}-today-marker`}
                  />
                ) : null}
                <UiText style={styles.cellText} variant="subtitle">
                  {dateKeyToDayOfMonth(cell.dateKey)}
                </UiText>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const getVisibleGridHeight = (visibleWeekCount: number) =>
  visibleWeekCount * CELL_SIZE + Math.max(visibleWeekCount - 1, 0) * ROW_GAP;

const compareDateKeys = (left: string, right: string) => left.localeCompare(right);

const dateKeyToUtcDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const formatUtcDateKey = (date: Date) => {
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * MS_PER_DAY);

const startOfMondayWeek = (date: Date) => {
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addDays(date, -mondayOffset);
};

const dateKeyToDayOfMonth = (dateKey: string) => String(dateKeyToUtcDate(dateKey).getUTCDate());

const formatAccessibleDate = (dateKey: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(dateKeyToUtcDate(dateKey));

const buildCellAccessibilityLabel = (cell: CalendarHeatmapCell) => {
  const effortText =
    cell.bucket === 0
      ? 'No effort.'
      : `Effort ${formatEffort(cell.totalWeight)}. Bucket ${cell.bucket} of 4.`;
  const todayText = cell.isToday ? ' Today.' : '';
  const selectedText = cell.isSelected ? ' Selected.' : '';

  return `${formatAccessibleDate(cell.dateKey)}. ${effortText}${todayText}${selectedText}`;
};

const formatEffort = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');

const styles = StyleSheet.create({
  container: {
    gap: uiSpace.sm,
  },
  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: COLUMN_GAP,
  },
  weekdayLabel: {
    width: CELL_SIZE,
    textAlign: 'center',
    fontSize: uiTypography.size.xs,
  },
  weekViewport: {
    alignSelf: 'center',
  },
  weekList: {
    gap: ROW_GAP,
  },
  weekRow: {
    flexDirection: 'row',
    gap: COLUMN_GAP,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: uiRadius.sm,
    borderWidth: uiBorder.width,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCell: {
    borderColor: uiColors.heatmapTodayBorder,
  },
  todayNeutralCell: {
    backgroundColor: uiColors.heatmapTodayBg,
  },
  selectedCell: {
    borderColor: uiColors.heatmapSelectedBorder,
    borderWidth: uiBorder.width + 1,
  },
  todayMarker: {
    position: 'absolute',
    top: uiSpace.xs,
    right: uiSpace.xs,
    width: 6,
    height: 6,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.heatmapTodayMarker,
  },
  cellText: {
    color: uiColors.textAccentStrong,
    fontSize: uiTypography.size.xs,
    lineHeight: 13,
  },
});

const bucketStyles = StyleSheet.create({
  0: {
    backgroundColor: uiColors.heatmapNeutralBg,
    borderColor: uiColors.heatmapNeutralBorder,
  },
  1: {
    backgroundColor: uiColors.heatmapBucket1,
    borderColor: uiColors.heatmapBucket1,
  },
  2: {
    backgroundColor: uiColors.heatmapBucket2,
    borderColor: uiColors.heatmapBucket2,
  },
  3: {
    backgroundColor: uiColors.heatmapBucket3,
    borderColor: uiColors.heatmapBucket3,
  },
  4: {
    backgroundColor: uiColors.heatmapBucket4,
    borderColor: uiColors.heatmapBucket4,
  },
});
