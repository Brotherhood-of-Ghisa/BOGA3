import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DailyHeatmap, WeeklyHeatmap, buildHeatmapData } from '@/components/heatmaps';
import type { CalendarHeatmapMetric, DailyEffortMetrics } from '@/src/data';

const TODAY = '2026-10-09';
const PREFIX = 'records';
const days: DailyEffortMetrics[] = [
  { dateKey: '2026-10-05', totalVolume: 1000, workingSetCount: 4, estimatedRM1: 140, highestWeight: 120,
    personalRecordCounts: { totalVolume: 2, estimatedRM1: 1, highestWeight: 3 } },
  { dateKey: '2026-10-07', totalVolume: 1400, workingSetCount: 5, estimatedRM1: 150, highestWeight: 120,
    personalRecordCounts: { totalVolume: 2, estimatedRM1: 4, highestWeight: 0 } },
];

it.each([
  ['totalVolume', 'Volume', 2, 4],
  ['estimatedRM1', '1RM', 1, 5],
  ['highestWeight', 'Top weight', 3, 3],
  ['workingSetCount', 'Sets', 0, 0],
] as const)('shows only matching %s PRs: one daily triangle and the weekly event count', (metric, label, dailyCount, weeklyCount) => {
  const data = buildHeatmapData(days, metric, { todayDateKey: TODAY, weeks: 1 });
  expect(data.daily.find(day => day.dateKey === '2026-10-05')?.prCount).toBe(dailyCount);
  expect(data.weekly.at(-1)?.prCount).toBe(weeklyCount);
  const { unmount } = render(<DailyHeatmap data={data} testIDPrefix={PREFIX} metricLabel={label} formatValue={String} />);
  const markers = screen.queryAllByTestId('records-heatmap-cell-2026-10-05-pr', { includeHiddenElements: true });
  expect(markers).toHaveLength(dailyCount > 0 ? 1 : 0);
  if (dailyCount > 0) expect(screen.getByTestId('records-heatmap-cell-2026-10-05').props.accessibilityLabel)
    .toContain(`${dailyCount} PR${dailyCount === 1 ? '' : 's'}`);
  expect(screen.queryByTestId('records-heatmap-cell-2026-10-06-pr', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByTestId('records-heatmap-day-detail')).toBeNull();
  expect(StyleSheet.flatten(screen.getByTestId('records-heatmap-cell-2026-10-05').props.style).borderWidth).toBe(StyleSheet.hairlineWidth);
  unmount();
  render(<WeeklyHeatmap data={data} testIDPrefix={PREFIX} metricLabel={label} formatValue={String} />);
  if (weeklyCount > 0) {
    expect(screen.getByTestId('records-heatmap-prs-2026-10-05')).toHaveTextContent(`${weeklyCount} PRs`);
    expect(screen.getByTestId('records-heatmap-cell-2026-10-05').props.accessibilityLabel).toContain(`${weeklyCount} PRs`);
  } else expect(screen.queryAllByTestId(/-prs-/)).toHaveLength(0);
  expect(screen.queryByTestId('records-heatmap-prs-2026-09-28')).toBeNull();
});

it('keeps rest, known zero and unavailable states while omitting absent PRs and the Week-tile marker', () => {
  const data = buildHeatmapData([
    { ...days[0], totalVolume: 0, personalRecordCounts: undefined },
    { ...days[1], totalVolume: null, personalRecordCounts: { totalVolume: 1, estimatedRM1: 0, highestWeight: 0 } },
  ], 'totalVolume', { todayDateKey: '2026-10-11', weeks: 1 });
  render(<DailyHeatmap data={data} testIDPrefix={PREFIX} metricLabel="Volume" formatValue={String} />);
  expect(screen.getByTestId('records-heatmap-cell-2026-10-05')).toHaveProp('accessibilityLabel', '2026-10-05, Volume 0');
  expect(screen.getByTestId('records-heatmap-cell-2026-10-06')).toHaveProp('accessibilityLabel', '2026-10-06, Rest');
  expect(screen.getByTestId('records-heatmap-cell-2026-10-07')).toHaveProp('accessibilityLabel', '2026-10-07, Volume unavailable, 1 PR');
  expect(screen.getByTestId('records-heatmap-cell-2026-10-05-value')).toHaveTextContent('0');
  expect(screen.queryByTestId('records-heatmap-week-2026-10-2026-10-05-pr', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByText(/Rest/)).toBeNull();
});

it.each(['totalVolume', 'workingSetCount'] as CalendarHeatmapMetric[])('adds no records to muscle history (%s)', metric => {
  const data = buildHeatmapData(days.map(day => ({ ...day, personalRecordCounts: undefined })), metric, { todayDateKey: TODAY });
  expect(data.daily.every(day => day.prCount === 0)).toBe(true);
  expect(data.weekly.every(week => week.prCount === 0)).toBe(true);
});
