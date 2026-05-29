import { Pressable, StyleSheet, View } from 'react-native';

import { uiBorder, uiColors, uiRadius, uiSpace } from '@/components/ui';
import type { CalendarHeatmapMetric, SelectedMuscleWeeklyEffort } from '@/src/data';

export type { CalendarHeatmapMetric };

const CELL_SIZE = 38;
const CELL_GAP = uiSpace.xs;
const WEEKS_PER_ROW = 4;
const MIN_MONTH_COUNT = 6;

export type CalendarHeatmapBucket = 0 | 1 | 2 | 3 | 4;

export type CalendarHeatmapWeekCell = {
  weekStartDateKey: string;
  metricValue: number | null;
  bucket: CalendarHeatmapBucket;
  isCurrentWeek: boolean;
  isSelected: boolean;
};

export type CalendarHeatmapMonthRow = {
  monthKey: string;
  monthLabel: string;
  cells: (CalendarHeatmapWeekCell | null)[];
};

export type CalendarHeatmapProps = {
  weeklyEffort: SelectedMuscleWeeklyEffort[];
  metric: CalendarHeatmapMetric;
  selectedWeekKey: string | null;
  onSelectWeek: (weekStartDateKey: string | null) => void;
  today?: string;
  testID?: string;
};

export const getCurrentLocalDateKey = () => {
  const now = new Date();
  const year = now.getFullYear().toString().padStart(4, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const monthKeyToLabel = (monthKey: string): string => {
  const monthIndex = Number(monthKey.split('-')[1]) - 1;
  return MONTH_NAMES[monthIndex] ?? '';
};

export const getCalendarHeatmapBucket = (
  value: number,
  maxPositive: number
): CalendarHeatmapBucket => {
  if (value <= 0 || maxPositive <= 0) return 0;
  const ratio = value / maxPositive;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
};

const getMetricValue = (week: SelectedMuscleWeeklyEffort, metric: CalendarHeatmapMetric): number | null => {
  switch (metric) {
    case 'totalVolume': return week.totalVolume > 0 ? week.totalVolume : null;
    case 'nearFailureCount': return week.nearFailureCount > 0 ? week.nearFailureCount : null;
    case 'estimatedRM1': return week.estimatedRM1;
    case 'highestWeight': return week.highestWeight;
  }
};

const getCurrentWeekStartDateKey = (todayDateKey: string): string => {
  const [year, month, day] = todayDateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const monday = new Date(date.getTime() - mondayOffset * 24 * 60 * 60 * 1000);
  const y = monday.getUTCFullYear().toString().padStart(4, '0');
  const m = (monday.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = monday.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const buildBaselineMonthKeys = (todayDateKey: string): string[] => {
  const [y, m] = todayDateKey.split('-').map(Number);
  const keys: string[] = [];
  for (let i = MIN_MONTH_COUNT - 1; i >= 0; i--) {
    const month = ((m - 1 - i + 120) % 12) + 1;
    const year = y + Math.floor((m - 1 - i) / 12);
    keys.push(`${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}`);
  }
  return keys;
};

export const buildCalendarHeatmapMonthRows = (
  weeklyEffort: SelectedMuscleWeeklyEffort[],
  metric: CalendarHeatmapMetric,
  selectedWeekKey: string | null,
  todayDateKey: string
): CalendarHeatmapMonthRow[] => {
  const currentWeekKey = getCurrentWeekStartDateKey(todayDateKey);

  const maxValue = weeklyEffort.reduce((max, week) => {
    const v = getMetricValue(week, metric);
    return v !== null && v > max ? v : max;
  }, 0);

  const byMonthWeek = new Map<string, SelectedMuscleWeeklyEffort>();
  for (const week of weeklyEffort) {
    byMonthWeek.set(`${week.monthKey}-${week.weekOfMonth}`, week);
  }

  // Ensure at least MIN_MONTH_COUNT months are shown, padded with empty rows if needed.
  // Reverse-chronological: current month first.
  const effortMonthKeys = new Set(weeklyEffort.map((w) => w.monthKey));
  const baselineKeys = buildBaselineMonthKeys(todayDateKey);
  const allMonthKeys = Array.from(new Set([...baselineKeys, ...effortMonthKeys])).sort().reverse();

  return allMonthKeys.map((monthKey) => {
    const cells: (CalendarHeatmapWeekCell | null)[] = Array.from(
      { length: WEEKS_PER_ROW },
      (_, i) => {
        const week = byMonthWeek.get(`${monthKey}-${i + 1}`);
        if (!week) return null;
        const metricValue = getMetricValue(week, metric);
        const numericValue = metricValue ?? 0;
        return {
          weekStartDateKey: week.weekStartDateKey,
          metricValue,
          bucket: getCalendarHeatmapBucket(numericValue, maxValue),
          isCurrentWeek: week.weekStartDateKey === currentWeekKey,
          isSelected: week.weekStartDateKey === selectedWeekKey,
        };
      }
    );

    return {
      monthKey,
      monthLabel: monthKeyToLabel(monthKey),
      cells,
    };
  });
};

export function CalendarHeatmap({
  weeklyEffort,
  metric,
  selectedWeekKey,
  onSelectWeek,
  today,
  testID = 'calendar-heatmap',
}: CalendarHeatmapProps) {
  const todayDateKey = today ?? getCurrentLocalDateKey();
  const monthRows = buildCalendarHeatmapMonthRows(weeklyEffort, metric, selectedWeekKey, todayDateKey);

  return (
    <View style={styles.container} testID={testID}>
      {monthRows.map((row) => (
        <View key={row.monthKey} style={styles.monthRow} testID={`${testID}-month-${row.monthKey}`}>
          <View style={styles.cellRow}>
            {row.cells.map((cell, i) =>
              cell === null ? (
                <View
                  key={`${row.monthKey}-empty-${i}`}
                  style={[styles.cell, bucketStyles[0]]}
                  testID={`${testID}-cell-empty-${row.monthKey}-${i + 1}`}
                />
              ) : (
                <Pressable
                  accessibilityHint="Select this week"
                  accessibilityLabel={buildWeekCellAccessibilityLabel(cell, metric)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: cell.isSelected }}
                  key={cell.weekStartDateKey}
                  onPress={() =>
                    onSelectWeek(cell.isSelected ? null : cell.weekStartDateKey)
                  }
                  style={[
                    styles.cell,
                    bucketStyles[cell.bucket],
                    cell.isCurrentWeek && cell.bucket === 0 ? styles.currentWeekNeutralCell : null,
                    cell.isCurrentWeek ? styles.currentWeekCell : null,
                    cell.isSelected ? styles.selectedCell : null,
                  ]}
                  testID={`${testID}-cell-${cell.weekStartDateKey}`}
                />
              )
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const buildWeekCellAccessibilityLabel = (
  cell: CalendarHeatmapWeekCell,
  metric: CalendarHeatmapMetric
): string => {
  const metricLabel =
    metric === 'totalVolume'
      ? 'Volume'
      : metric === 'nearFailureCount'
        ? 'Near-failure sets'
        : metric === 'estimatedRM1'
          ? 'Estimated 1RM'
          : 'Top weight';

  const valueText =
    cell.metricValue === null
      ? 'No data'
      : `${metricLabel} ${cell.metricValue.toFixed(1)}. Bucket ${cell.bucket} of 4`;

  const currentText = cell.isCurrentWeek ? ' Current week.' : '';
  const selectedText = cell.isSelected ? ' Selected.' : '';

  return `Week of ${cell.weekStartDateKey}. ${valueText}.${currentText}${selectedText}`;
};

const styles = StyleSheet.create({
  container: {
    gap: uiSpace.xs,
  },
  monthRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  cellRow: {
    flexDirection: 'row',
    gap: CELL_GAP,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: uiRadius.sm,
    borderWidth: uiBorder.width,
  },
  currentWeekCell: {
    borderColor: uiColors.heatmapTodayBorder,
    borderWidth: uiBorder.width + 2,
  },
  currentWeekNeutralCell: {
    backgroundColor: uiColors.heatmapTodayBg,
  },
  selectedCell: {
    borderColor: uiColors.heatmapSelectedBorder,
    borderWidth: uiBorder.width + 1,
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
