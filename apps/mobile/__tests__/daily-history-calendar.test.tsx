import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { FlatList, ScrollView, StyleSheet } from 'react-native';
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

it('orders months and whole week rows newest first, with eight headers and outside start-day labels', () => {
  draw();
  expect(screen.getAllByTestId(/^calendar-heatmap-month-\d{4}-\d{2}$/).map(month => month.props.testID))
    .toEqual(['calendar-heatmap-month-2026-10', 'calendar-heatmap-month-2026-09']);
  const october = within(screen.getByTestId('calendar-heatmap-month-2026-10'));
  for (const label of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week']) expect(october.getByText(label)).toBeTruthy();
  expect(screen.getByTestId('calendar-heatmap-row-label-2026-10-05')).toHaveTextContent('5');
  expect(screen.queryByTestId('calendar-heatmap-cell-2026-10-06-date')).toBeNull();
  expect(october.getAllByTestId(/^calendar-heatmap-cell-\d{4}-\d{2}-\d{2}$/).map(tile => tile.props.testID)).toEqual(
    [5, 6].map(day => `calendar-heatmap-cell-2026-10-${String(day).padStart(2, '0')}`));
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-05')).toHaveProp('accessibilityLabel', '2026-10-05, Volume 2560');
  expect(screen.UNSAFE_queryAllByType(ScrollView)).toHaveLength(1);
  expect(screen.UNSAFE_getByType(FlatList).props).toMatchObject({ initialNumToRender: 2, maxToRenderPerBatch: 2, windowSize: 3 });
  expect(style('calendar-heatmap-cell-2026-10-05').minHeight).toBeGreaterThanOrEqual(uiGeometry.tapTarget);
  expect(style('calendar-heatmap-cell-2026-10-05').minWidth).toBe(0);
  expect(style('calendar-heatmap-week-separator-2026-10')).toMatchObject({ right: '12.5%', width: 1, backgroundColor: uiRoles.rule, top: 0, bottom: 0 });
});

it.each(['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight'] as const)(
  'shows formatted %s and a full cross-month Week total in its start month once Sunday arrives', metric => {
    const { data } = draw(metric);
    expect(screen.queryByText(labels[metric], { exact: true })).toBeNull();
    const week = data.weekly.find(week => week.weekStartDateKey === '2026-09-28')!;
    const id = 'calendar-heatmap-week-2026-09-2026-09-28';
    expect(screen.getByTestId(`${id}-value`)).toHaveTextContent(formats[metric](week.value));
    expect(style(id).backgroundColor).toBe([uiRoles.viz0, uiRoles.viz1, uiRoles.viz2, uiRoles.viz3, uiRoles.viz4][week.level]);
    expect(screen.queryByTestId('calendar-heatmap-week-2026-10-2026-09-28')).toBeNull();
    expect(screen.queryByTestId('calendar-heatmap-week-2026-10-2026-10-05')).toBeNull();
    expect(screen.getByTestId('calendar-heatmap-cell-2026-10-05-value')).toHaveTextContent(formats[metric](samples[4][metric]!));
    expect(screen.queryByTestId('calendar-heatmap-day-detail')).toBeNull();
  });

it('exposes read-only day and week values without selection or black outlines', () => {
  draw();
  const ids = ['calendar-heatmap-cell-2026-10-05', `calendar-heatmap-cell-${today}`,
    'calendar-heatmap-week-2026-09-2026-09-28'];
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
  expect(screen.queryByTestId('calendar-heatmap-week-2026-10-2026-10-05')).toBeNull();
  expect(screen.queryByTestId('calendar-heatmap-day-detail')).toBeNull();
});

it('opens a day with sessions and a Week tile with training, and offers no rest day or rest week', () => {
  const onOpenDay = jest.fn();
  const onOpenWeek = jest.fn();
  const input = samples.map((day, index) => ({ ...day, sessionIds: index === 1 ? ['a', 'b'] : [`s-${index}`] }));
  const data = buildHeatmapData(input, 'totalVolume', { todayDateKey: today, weeks: 5 });
  render(<DailyHeatmap data={data} testIDPrefix={prefix} metricLabel="Volume" formatValue={formatVolume}
    onOpenDay={onOpenDay} onOpenWeek={onOpenWeek} />);

  const one = screen.getByTestId('calendar-heatmap-cell-2026-10-05');
  expect(one).toHaveProp('accessibilityRole', 'button');
  expect(one).toHaveProp('accessibilityLabel', '2026-10-05, Volume 2560');
  expect(one).toHaveProp('accessibilityHint', 'Opens the session');
  expect(screen.getByTestId('calendar-heatmap-cell-2026-09-30')).toHaveProp('accessibilityHint', "Opens the day's sessions");
  fireEvent.press(one);
  expect(onOpenDay).toHaveBeenCalledWith(expect.objectContaining({ dateKey: '2026-10-05', sessionIds: ['s-4'] }));

  const week = screen.getByTestId('calendar-heatmap-week-2026-09-2026-09-28');
  expect(week).toHaveProp('accessibilityRole', 'button');
  expect(week).toHaveProp('accessibilityHint', "Opens the week's sessions");
  fireEvent.press(week);
  expect(onOpenWeek).toHaveBeenCalledWith('2026-09-28');

  // A rest day, and a whole rest week's tile, read as text.
  for (const id of ['calendar-heatmap-cell-2026-10-01', 'calendar-heatmap-week-2026-09-2026-09-07']) {
    expect(screen.getByTestId(id)).toHaveProp('accessibilityRole', 'text');
    expect(screen.getByTestId(id).props.onPress).toBeUndefined();
  }
});

it('leaves rest and unavailable figures blank, retains numeric zero and clips future weeks', () => {
  draw('totalVolume', [sample('2026-09-28', 0), sample('2026-10-02', 0), { ...sample('2026-10-03', 0), totalVolume: null }]);
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-01-value')).toHaveTextContent('', { exact: true });
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-01').props.accessibilityLabel).toContain('Rest');
  expect(screen.queryAllByText('Rest')).toEqual([]);
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-02-value')).toHaveTextContent('0');
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-03-value')).toHaveTextContent('', { exact: true });
  expect(screen.getByTestId('calendar-heatmap-week-2026-09-2026-09-28-value')).toHaveTextContent('', { exact: true });
  expect(screen.queryByText(/\?/)).toBeNull();
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-03').props.accessibilityLabel).toBe('2026-10-03, Volume unavailable');
  expect(screen.queryByText(/incomplete/)).toBeNull();
  expect(style('calendar-heatmap-cell-2026-10-03').borderStyle).toBe('dashed');
  expect(screen.queryByTestId('calendar-heatmap-cell-2026-10-07')).toBeNull();
  expect(screen.queryByLabelText('2026-10-07, Future, no observed value')).toBeNull();
  expect(style('calendar-heatmap-empty-2026-10-2026-10-07').backgroundColor).toBeUndefined();
  expect(screen.queryByTestId('calendar-heatmap-week-2026-10-2026-10-12')).toBeNull();
});

it('keeps a boundary week together in its start month without duplicate days or rows', () => {
  draw();
  const october = within(screen.getByTestId('calendar-heatmap-month-2026-10'));
  const september = within(screen.getByTestId('calendar-heatmap-month-2026-09'));
  expect(october.queryByTestId('calendar-heatmap-row-2026-09-28')).toBeNull();
  expect(september.getByTestId('calendar-heatmap-cell-2026-10-01')).toBeTruthy();
  expect(september.getByTestId('calendar-heatmap-week-2026-09-2026-09-28')).toBeTruthy();
  expect(screen.getAllByTestId('calendar-heatmap-cell-2026-09-28')).toHaveLength(1);
  expect(screen.getAllByTestId('calendar-heatmap-row-label-2026-09-28')).toHaveLength(1);
  const row = screen.getByTestId('calendar-heatmap-row-2026-09-28');
  expect(within(row).getByTestId('calendar-heatmap-row-label-2026-09-28')).toHaveTextContent('28');
  expect(within(screen.getByTestId('calendar-heatmap-cell-2026-09-28')).queryByText('28')).toBeNull();
  expect(screen.queryByTestId('calendar-heatmap-week-2026-10-2026-10-05')).toBeNull();
});

it.each(['2026-10-10', '2026-10-11', '2026-10-12'])('adds a seven-day Week tile on Sunday and afterwards (%s)', date => {
  const data = buildHeatmapData(samples, 'totalVolume', { todayDateKey: date, weeks: 2 });
  render(<DailyHeatmap data={data} testIDPrefix={prefix} metricLabel="Volume" formatValue={formatVolume} />);
  const id = 'calendar-heatmap-week-2026-10-2026-10-05';
  if (date === '2026-10-10') expect(screen.queryByTestId(id)).toBeNull();
  else {
    expect(screen.getByTestId(`${id}-value`)).toHaveTextContent('3400');
    expect(screen.getByTestId(id).props.accessibilityLabel.includes('Current week')).toBe(date === '2026-10-11');
    expect(style(id)).toMatchObject({ borderWidth: StyleSheet.hairlineWidth, borderColor: uiRoles.rule });
  }
});

it('keeps a partial first sample row without a Week tile, then includes a Sunday week with rest days', () => {
  const data = buildHeatmapData([sample('2026-09-29', 100), sample('2026-10-05', 200)],
    'totalVolume', { todayDateKey: '2026-10-11', weeks: 3 });
  data.daily = data.daily.filter(day => day.dateKey >= '2026-09-29');
  render(<DailyHeatmap data={data} testIDPrefix={prefix} metricLabel="Volume" formatValue={formatVolume} />);
  expect(screen.getByTestId('calendar-heatmap-cell-2026-09-29-value')).toHaveTextContent('100');
  expect(screen.queryByTestId('calendar-heatmap-cell-2026-09-28')).toBeNull();
  expect(screen.queryByTestId('calendar-heatmap-week-2026-09-2026-09-28')).toBeNull();
  expect(style('calendar-heatmap-empty-week-2026-09-2026-09-28').backgroundColor).toBeUndefined();
  expect(screen.queryByTestId('calendar-heatmap-week-2026-09-2026-09-21')).toBeNull();
  expect(screen.getByTestId('calendar-heatmap-week-2026-10-2026-10-05-value')).toHaveTextContent('200');
});

it('preserves muscle target grading on daily and weekly tiles', () => {
  const data = buildHeatmapData([{ ...sample('2026-10-05', 1), workingSetCount: 3, workingSetCountsByMuscle: { chest: 3 } }],
    'workingSetCount', { todayDateKey: '2026-10-12', weeks: 2, muscleTargets: { muscleIds: ['chest'], weeklyTarget: 10 } });
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
  expect(screen.getByTestId('calendar-heatmap-week-2026-09-2026-09-28-value')).toHaveTextContent('8', { exact: true });
  expect(screen.getByTestId('calendar-heatmap-cell-2026-10-05').props.accessibilityLabel).toContain('Sets 2');
  const short = buildHeatmapData(samples, 'totalVolume', { todayDateKey: today, weeks: 1 });
  rerender(<DailyHeatmap data={short} testIDPrefix={prefix} metricLabel="Volume" formatValue={formatVolume} />);
  expect(screen.getByTestId(`calendar-heatmap-cell-${today}-value`)).toHaveTextContent('840');
  expect(screen.queryByTestId('calendar-heatmap-week-2026-09-2026-09-28')).toBeNull();
});

it.each([320, 375, 402, 448])('centres the Sun/Week separator in a wider gap at %ipt', width => {
  draw();
  fireEvent(screen.getByTestId('calendar-heatmap'), 'layout', { nativeEvent: { layout: { width } } });
  const gridWidth = width - uiSpace.sm * 2 - uiSpace.xl - uiSpace.xs;
  const gap = Math.max(0, Math.min(uiSpace.xs, (gridWidth - uiSpace.sm - 8 * uiGeometry.tapTarget) / 7));
  const cells = screen.getByTestId('calendar-heatmap-row-2026-10-05').props.children[1];
  expect(StyleSheet.flatten(cells.props.style).gap).toBe(gap);
  const column = (gridWidth - 7 * gap - uiSpace.sm) / 8;
  const sunRight = 7 * column + 6 * gap;
  const weekLeft = 7 * column + 7 * gap + uiSpace.sm;
  const separator = style('calendar-heatmap-week-separator-2026-10');
  const lineCentre = gridWidth * 7 / 8 - uiBorder.width + separator.transform[0].translateX + uiBorder.width / 2;
  expect(lineCentre - sunRight).toBeCloseTo(weekLeft - lineCentre);
  expect(style('calendar-heatmap-week-2026-09-2026-09-28').marginLeft).toBe(uiSpace.sm);
  expect(style('calendar-heatmap-empty-week-2026-10-2026-10-05').marginLeft).toBe(uiSpace.sm);
  const date = style('calendar-heatmap-row-label-2026-10-05');
  expect(date).toMatchObject({ width: uiSpace.xl, textAlign: 'right', fontSize: uiTypography.size.xxs, color: uiRoles.inkMuted });
  expect(date.position).toBeUndefined();
  expect(date.fontSize).toBeLessThan(style('calendar-heatmap-cell-2026-10-05-value').fontSize);
});

it('shows a cross-month total on Sunday with sampled rest days preceding the first workout', () => {
  const data = buildHeatmapData([sample('2026-09-29', 100), sample('2026-10-04', 200)],
    'totalVolume', { todayDateKey: '2026-10-04', weeks: 1 });
  render(<DailyHeatmap data={data} testIDPrefix={prefix} metricLabel="Volume" formatValue={formatVolume} />);
  expect(screen.getByTestId('calendar-heatmap-cell-2026-09-28-value')).toHaveTextContent('', { exact: true });
  expect(screen.getByTestId('calendar-heatmap-week-2026-09-2026-09-28-value')).toHaveTextContent('300');
  expect(screen.getByTestId('calendar-heatmap-week-2026-09-2026-09-28').props.accessibilityLabel).toContain('Current week');
  expect(screen.queryByTestId('calendar-heatmap-week-2026-10-2026-09-28')).toBeNull();
});

it.each(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])(
  'shows daily tiles only through today and a Week tile once Sunday arrives (%s)', date => {
    const data = buildHeatmapData(samples, 'totalVolume', { todayDateKey: date, weeks: 1 });
    render(<DailyHeatmap data={data} testIDPrefix={prefix} metricLabel="Volume" formatValue={formatVolume} />);
    expect(screen.getAllByTestId(/^calendar-heatmap-cell-\d{4}-\d{2}-\d{2}$/).map(tile => tile.props.testID))
      .toEqual(data.daily.map(day => `calendar-heatmap-cell-${day.dateKey}`));
    expect(screen.queryAllByLabelText(/Future/)).toEqual([]);
    expect(screen.queryByTestId('calendar-heatmap-week-2026-10-2026-10-05') !== null).toBe(date === '2026-10-11');
    if (date < '2026-10-11') {
      const empty = screen.getByTestId('calendar-heatmap-empty-2026-10-2026-10-11');
      expect(StyleSheet.flatten(empty.props.style).backgroundColor).toBeUndefined();
      expect(empty.props.accessibilityLabel).toBeUndefined();
    }
  });

it('uses quieter month headings and keeps the grid values larger than row dates', () => {
  draw();
  expect(style('calendar-heatmap-month-title-2026-09')).toMatchObject({
    color: uiRoles.inkMuted, fontSize: uiTypography.size.sm, fontWeight: '400',
  });
  expect(style('calendar-heatmap-month-title-2026-09').fontSize).toBeLessThan(uiTypography.size.xl);
});

it('keeps the full window in the month list while mounting only the initial months', () => {
  const data = buildHeatmapData(samples, 'totalVolume', { todayDateKey: today, weeks: 104 });
  render(<DailyHeatmap data={data} testIDPrefix={prefix} metricLabel="Volume" formatValue={formatVolume} />);
  const list = screen.UNSAFE_getByType(FlatList);
  expect(list.props.data).toHaveLength(25);
  expect(screen.getAllByTestId(/^calendar-heatmap-month-title-/)).toHaveLength(2);
  const older = list.props.data.at(-1);
  const oldMonth = render(list.props.renderItem({ item: older, index: 24 }));
  expect(oldMonth.getByTestId(`calendar-heatmap-month-title-${older.key}`)).toBeTruthy();
});
