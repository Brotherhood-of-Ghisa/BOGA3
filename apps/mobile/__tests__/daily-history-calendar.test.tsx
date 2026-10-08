import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { ScrollView, StyleSheet } from 'react-native';
import { DailyHeatmap, buildHeatmapData } from '@/components/heatmaps';
import { uiBorder, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { CalendarHeatmapMetric, DailyEffortMetrics } from '@/src/data';
import { formatOneRepMax, formatVolume, formatWeight } from '@/src/exercise-calculations/format';

const today = '2026-10-06';
const prefix = 'calendar';
const sample = (dateKey: string, totalVolume: number): DailyEffortMetrics => ({ dateKey, totalVolume,
  workingSetCount: 2, estimatedRM1: 95.5, highestWeight: 80 });
const samples = [sample('2026-09-28', 2400), sample('2026-09-30', 3200),
  sample('2026-10-02', 3600), sample('2026-10-03', 1600), sample('2026-10-05', 2560), sample(today, 840)];
const formats = { totalVolume: formatVolume, workingSetCount: String, estimatedRM1: formatOneRepMax, highestWeight: formatWeight };
const labels = { totalVolume: 'Volume', workingSetCount: 'Sets', estimatedRM1: '1RM', highestWeight: 'Top weight' };
const draw = (metric: CalendarHeatmapMetric = 'totalVolume', input = samples) => {
  const data = buildHeatmapData(input, metric, { todayDateKey: today, weeks: 5 });
  return { data, ...render(<DailyHeatmap data={data} testIDPrefix={prefix} metricLabel={labels[metric]} formatValue={formats[metric]} />) };
};
const style = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);

it('stacks full month calendars newest first, with eight headers and Monday-only dates', () => {
  draw();
  expect(screen.getAllByTestId(/^calendar-heatmap-month-\d{4}-\d{2}$/).map(month => month.props.testID))
    .toEqual(['calendar-heatmap-month-2026-10', 'calendar-heatmap-month-2026-09']);
  const october = within(screen.getByTestId('calendar-heatmap-month-2026-10'));
  for (const label of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week']) expect(october.getByText(label)).toBeTruthy();
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-05-date')).toHaveTextContent('5');
  expect(screen.queryByTestId('calendar-heatmap-cell-2026-10-06-date')).toBeNull();
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-05')).toHaveProp('accessibilityLabel', '2026-10-05, Volume 2560');
  expect(screen.UNSAFE_queryAllByType(ScrollView)).toEqual([]);
  expect(style('calendar-heatmap-cell-2026-10-05').minHeight).toBeGreaterThanOrEqual(uiGeometry.tapTarget);
  expect(style('calendar-heatmap-cell-2026-10-05').minWidth).toBe(0);
  expect(style('calendar-heatmap-week-separator-2026-10')).toMatchObject({ right: '12.5%', width: 1, backgroundColor: uiRoles.rule, top: 0, bottom: 0 });
});

it.each(['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight'] as const)(
  'shows formatted %s figures and the same weekly value and colour in each adjoining month', metric => {
    const { data } = draw(metric);
    expect(screen.queryByText(labels[metric], { exact: true })).toBeNull();
    const week = data.weekly.find(week => week.weekStartDateKey === '2026-09-28')!;
    for (const month of ['2026-09', '2026-10']) {
      const id = `calendar-heatmap-week-${month}-2026-09-28`;
      expect(screen.getByTestId(`${id}-value`)).toHaveTextContent(formats[metric](week.value));
      expect(style(id).backgroundColor).toBe([uiRoles.viz0, uiRoles.viz1, uiRoles.viz2, uiRoles.viz3, uiRoles.viz4][week.level]);
    }
    expect(screen.getByTestId('calendar-heatmap-cell-2026-10-05-value')).toHaveTextContent(formats[metric](samples[4][metric]!));
    expect(screen.queryByTestId('calendar-heatmap-day-detail')).toBeNull();
  });

it('exposes read-only day and week values without selection or black outlines', () => {
  draw();
  const ids = ['calendar-heatmap-cell-2026-10-05', `calendar-heatmap-cell-${today}`,
    'calendar-heatmap-week-2026-10-2026-09-28', 'calendar-heatmap-week-2026-10-2026-10-05'];
  for (const id of ids) {
    const tile = screen.getByTestId(id);
    expect(tile).toHaveProp('accessible', true);
    expect(tile).toHaveProp('accessibilityRole', 'text');
    expect(tile.props.onPress).toBeUndefined();
    expect(tile.props.accessibilityState).toBeUndefined();
    expect(style(id)).toMatchObject({ borderWidth: StyleSheet.hairlineWidth, borderColor: uiRoles.rule });
  }
  expect(screen.queryAllByRole('button')).toEqual([]);
  expect(screen.getByTestId(`calendar-heatmap-cell-${today}`).props.accessibilityLabel).toContain('Today');
  expect(screen.getByTestId('calendar-heatmap-week-2026-10-2026-10-05').props.accessibilityLabel).toContain('Current week');
  expect(screen.queryByTestId('calendar-heatmap-day-detail')).toBeNull();
});

it('leaves rest and unavailable figures blank, retains numeric zero and clips future weeks', () => {
  draw('totalVolume', [sample('2026-10-02', 0), { ...sample('2026-10-03', 0), totalVolume: null }]);
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-01-value')).toHaveTextContent('', { exact: true });
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-01').props.accessibilityLabel).toContain('Rest');
  expect(screen.queryAllByText('Rest')).toEqual([]);
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-02-value')).toHaveTextContent('0');
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-03-value')).toHaveTextContent('', { exact: true });
  expect(screen.getByTestId('calendar-heatmap-week-2026-10-2026-09-28-value')).toHaveTextContent('', { exact: true });
  expect(screen.queryByText(/\?/)).toBeNull();
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-03').props.accessibilityLabel).toBe('2026-10-03, Volume unavailable');
  expect(screen.queryByText(/incomplete/)).toBeNull();
  expect(style('calendar-heatmap-cell-2026-10-03').borderStyle).toBe('dashed');
  const future = screen.getByLabelText('2026-10-07, Future, no observed value');
  expect(future).toHaveProp('accessibilityRole', 'text');
  expect(within(future).getByTestId(`${future.props.testID}-value`)).toHaveTextContent('', { exact: true });
  expect(screen.queryByTestId('calendar-heatmap-week-2026-10-2026-10-12')).toBeNull();
});

it('de-emphasises adjoining dates by weight while preserving full ink and heat contrast', () => {
  draw();
  const adjacent = 'calendar-heatmap-adjacent-2026-10-cell-2026-09-28';
  const primary = 'calendar-heatmap-cell-2026-09-28';
  expect(style(adjacent).opacity).toBeUndefined();
  expect(style(adjacent).backgroundColor).toBe(style(primary).backgroundColor);
  expect(style(`${adjacent}-date`)).toMatchObject({ fontWeight: '500', color: uiRoles.ink });
  expect(style(`${primary}-date`)).toMatchObject({ fontWeight: '600', color: uiRoles.ink });
  expect(style(`${adjacent}-value`)).toMatchObject({ fontWeight: '500', color: uiRoles.ink });
  expect(style(`${primary}-value`)).toMatchObject({ fontWeight: '600', color: uiRoles.ink });
});

it('preserves muscle target grading on daily and weekly tiles', () => {
  const data = buildHeatmapData([{ ...sample('2026-10-05', 1), workingSetCount: 3, workingSetCountsByMuscle: { chest: 3 } }],
    'workingSetCount', { todayDateKey: today, weeks: 1, muscleTargets: { muscleIds: ['chest'], weeklyTarget: 10 } });
  render(<DailyHeatmap data={data} testIDPrefix={prefix} metricLabel="Sets" formatValue={String} />);
  expect(style('calendar-heatmap-cell-2026-10-05').backgroundColor).toBe(uiRoles.viz2);
  expect(style('calendar-heatmap-week-2026-10-2026-10-05').backgroundColor).toBe(uiRoles.viz2);
  expect(screen.getByTestId('calendar-heatmap-week-2026-10-2026-10-05').props.accessibilityLabel).toContain('30% of weekly muscle target');
  for (const text of ['Weekly target', '0%', '100%']) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.queryByText(/Less|More|Full colour|Colour:/)).toBeNull();
});

it('announces a grouped muscle target as averaged, and keeps Less…More for other metrics', () => {
  const sets = [{ ...sample('2026-10-05', 1), workingSetCount: 3, workingSetCountsByMuscle: { chest: 3 } }];
  const grouped = buildHeatmapData(sets, 'workingSetCount',
    { todayDateKey: today, weeks: 1, muscleTargets: { muscleIds: ['chest', 'triceps'], weeklyTarget: 10 } });
  const { unmount } = render(<DailyHeatmap data={grouped} testIDPrefix={prefix} metricLabel="Sets" formatValue={String} />);
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-05').props.accessibilityLabel)
    .toContain('15% of weekly muscle target, averaged across muscles');
  unmount();

  render(<DailyHeatmap data={buildHeatmapData(sets, 'totalVolume', { todayDateKey: today, weeks: 1 })}
    testIDPrefix={prefix} metricLabel="Volume" formatValue={String} legendLabel="Volume per day" />);
  for (const text of ['Volume per day', 'Less', 'More']) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.queryByText('Weekly target')).toBeNull();
});

it('updates the displayed history when its metric or look-back window changes', () => {
  const { rerender } = draw();
  const sets = buildHeatmapData(samples, 'workingSetCount', { todayDateKey: today, weeks: 5 });
  rerender(<DailyHeatmap data={sets} testIDPrefix={prefix} metricLabel="Sets" formatValue={String} />);
  expect(screen.getByTestId('calendar-heatmap-week-2026-10-2026-09-28-value')).toHaveTextContent('8', { exact: true });
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-05').props.accessibilityLabel).toContain('Sets 2');
  const short = buildHeatmapData(samples, 'totalVolume', { todayDateKey: today, weeks: 1 });
  rerender(<DailyHeatmap data={short} testIDPrefix={prefix} metricLabel="Volume" formatValue={formatVolume} />);
  expect(screen.getByTestId(`calendar-heatmap-cell-${today}-value`)).toHaveTextContent('840');
  expect(screen.queryByTestId('calendar-heatmap-week-2026-10-2026-09-28')).toBeNull();
});

it.each([320, 375, 402])('centres the Sun/Week separator in a wider gap at %ipt', width => {
  draw();
  fireEvent(screen.getByTestId('calendar-heatmap'), 'layout', { nativeEvent: { layout: { width } } });
  const gap = Math.max(0, Math.min(uiSpace.xs, (width - uiSpace.sm - 8 * uiGeometry.tapTarget) / 7));
  const column = (width - 7 * gap - uiSpace.sm) / 8;
  const sunRight = 7 * column + 6 * gap;
  const weekLeft = 7 * column + 7 * gap + uiSpace.sm;
  const separator = style('calendar-heatmap-week-separator-2026-10');
  const lineCentre = width * 7 / 8 - uiBorder.width + separator.transform[0].translateX + uiBorder.width / 2;
  expect(lineCentre - sunRight).toBeCloseTo(weekLeft - lineCentre);
  expect(style('calendar-heatmap-week-2026-10-2026-10-05').marginLeft).toBe(uiSpace.sm);
  const date = style('calendar-heatmap-cell-2026-10-05-date');
  expect(date).toMatchObject({ position: 'absolute', top: uiBorder.width, left: uiBorder.width, fontSize: uiTypography.size.xxs });
  expect(date.fontSize).toBeLessThan(style('calendar-heatmap-cell-2026-10-05-value').fontSize);
});
