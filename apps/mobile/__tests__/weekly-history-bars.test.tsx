import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { FlatList, ScrollView, StyleSheet } from 'react-native';

import { WeeklyHeatmap, buildHeatmapData } from '@/components/heatmaps';
import { HistoryView, EXERCISE_HISTORY_METRIC_OPTIONS, MUSCLE_HISTORY_METRIC_OPTIONS } from '@/components/stats/history-view';
import { uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { CalendarHeatmapMetric, DailyEffortMetrics } from '@/src/data';
import { ensureAccountLocalPreferencesLoaded, initializeAccountLocalPreferences, setAccountLocalPreferences } from '@/src/preferences/account-local';

const TODAY = '2026-10-05';
const PREFIX = 'bars';
const TIMELINE = { weekSetsTarget: { exerciseDefinitionId: 'bench' }, onOpenSession: jest.fn() };
const day = (dateKey: string, value: number | null): DailyEffortMetrics => ({
  dateKey, workingSetCount: value ?? 2, totalVolume: value,
  estimatedRM1: value, highestWeight: value,
});
const style = (id: string) => StyleSheet.flatten(screen.getByTestId(id, { includeHiddenElements: true }).props.style);
const data = (days: DailyEffortMetrics[], weeks = 8) => buildHeatmapData(days, 'totalVolume', { todayDateKey: TODAY, weeks });
const chart = (loaded: ReturnType<typeof data>, onOpenWeek: (key: string) => void = jest.fn()) =>
  <WeeklyHeatmap data={loaded} metric="totalVolume" onOpenWeek={onOpenWeek} testIDPrefix={PREFIX} formatValue={String} metricLabel="Volume" />;

it('shows occupied months with rest weeks newest first, compact week dates, aligned values and proportional Volume lengths', () => {
  const loaded = data([day(TODAY, 12), day('2026-09-28', 54), day('2026-09-14', 60)]);
  const chronological = loaded.weekly.map(week => week.weekStartDateKey);
  render(chart(loaded));
  expect(screen.getAllByTestId(/^bars-heatmap-cell-/).map(row => row.props.testID)).toEqual(
    ['2026-10-05', '2026-09-28', '2026-09-21', '2026-09-14', '2026-09-07'].map(key => `bars-heatmap-cell-${key}`));
  expect(loaded.weekly.map(week => week.weekStartDateKey)).toEqual(chronological);
  expect(screen.getByText('28 Sep – 4 Oct')).toBeTruthy();
  expect(style('bars-heatmap-bar-2026-10-05').width).toBe('20%');
  expect(style('bars-heatmap-bar-2026-09-28').width).toBe('90%');
  expect(style('bars-heatmap-bar-2026-09-14').width).toBe('100%');
  expect(screen.getByTestId('bars-heatmap-value-2026-09-28')).toHaveTextContent('54');
  expect(style('bars-heatmap-cell-2026-09-28').minHeight).toBeGreaterThanOrEqual(uiGeometry.tapTarget);
  expect(screen.UNSAFE_queryAllByType(ScrollView).every(view => !view.props.horizontal)).toBe(true);
});

const DATES = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', TODAY];

it('shows only the end year for a week crossing New Year', () => {
  render(chart(data([day('2025-12-31', 1750)], 52)));
  expect(screen.getByTestId('bars-heatmap-date-2025-12-29')).toHaveTextContent('29 Dec – 4 Jan');
  expect(screen.getByTestId('bars-heatmap-cell-2025-12-29')).toHaveProp(
    'accessibilityLabel', 'Week of 29-12-2025, Volume 1750');
});

it.each([
  ['2026-10-19', '19–25 Oct 2026'],
  ['2026-10-26', '26 Oct – 1 Nov 2026'],
  ['2026-09-28', '28 Sep – 4 Oct 2026'],
  ['2026-03-30', '30 Mar – 5 Apr 2026'],
  ['2025-12-29', '29 Dec – 4 Jan 2026'],
])('places the complete %s range left of its bar with the muted year on a second line', (key, caption) => {
  const loaded = buildHeatmapData([day(key, 12345)], 'totalVolume', { todayDateKey: key, weeks: 1 });
  render(chart(loaded));
  const date = screen.getByTestId(`bars-heatmap-date-${key}`);
  expect(date).toHaveTextContent(caption.replace(/ ?2026 ?/, ''));
  expect(date).toHaveProp('numberOfLines', 1);
  expect(date).toHaveProp('allowFontScaling', false);
  expect(StyleSheet.flatten(date.props.style)).toMatchObject({ fontSize: uiTypography.size.base, color: uiRoles.ink });
  expect(screen.getByTestId(`bars-heatmap-date-year-${key}`)).toHaveStyle({ color: uiRoles.inkMuted, fontSize: uiTypography.size.sm });
  expect(screen.getAllByTestId(new RegExp(`^bars-heatmap-(date|plot-row)-${key}$`)).map(node => node.props.testID))
    .toEqual([`bars-heatmap-plot-row-${key}`, `bars-heatmap-date-${key}`]);
  expect(style(`bars-heatmap-plot-row-${key}`)).toMatchObject({
    flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: uiSpace.sm,
  });
  expect(style(`bars-heatmap-date-gutter-${key}`)).toEqual({ width: 112 });
  expect(style(`bars-heatmap-plot-${key}`)).toMatchObject({ flex: 1, alignSelf: 'stretch', justifyContent: 'center' });
  expect(style(`bars-heatmap-track-${key}`).height).toBe(uiSpace.lg);
  expect(style(`bars-heatmap-bar-${key}`)).toMatchObject({ width: '100%', height: '100%' });
  expect(style(`bars-heatmap-value-${key}`)).toMatchObject({ textAlign: 'right' });
  expect(style(`bars-heatmap-value-column-${key}`)).toEqual({ width: 42 });
});

it('keeps the quieter year below the range when the Date format changes on a mounted chart', async () => {
  initializeAccountLocalPreferences(false);
  await ensureAccountLocalPreferencesLoaded();
  const loaded = buildHeatmapData([day('2025-12-29', 1750)], 'totalVolume', { todayDateKey: '2026-01-04', weeks: 1 });
  render(chart(loaded));
  for (const [dateFormat, caption, spoken] of [
    ['MM-DD-YYYY', 'Dec 29 – Jan 4 2026', '12-29-2025'],
    ['YYYY-MM-DD', '2026 Dec 29 – Jan 4', '2025-12-29'],
    ['DD-MM-YYYY', '29 Dec – 4 Jan 2026', '29-12-2025'],
  ] as const) {
    act(() => setAccountLocalPreferences({ dateFormat }));
    expect(screen.getByTestId('bars-heatmap-date-2025-12-29')).toHaveTextContent(caption.replace(/ ?2026 ?/, ''));
    expect(screen.getByTestId('bars-heatmap-date-year-2025-12-29')).toHaveTextContent('2026');
    expect(screen.getByTestId('bars-heatmap-date-year-2025-12-29')).toHaveStyle({ color: uiRoles.inkMuted });
    expect(screen.getByTestId('bars-heatmap-cell-2025-12-29')).toHaveProp('accessibilityLabel', `Week of ${spoken}, Volume 1750, Current week`);
  }
});

const percentage = (id: string, property: 'left' | 'width') => Number.parseFloat(style(id)[property]);
const renderValues = (values: number[], metric: CalendarHeatmapMetric) => render(<WeeklyHeatmap
  data={buildHeatmapData(values.map((value, index) => day(DATES[index], value)), metric, { todayDateKey: TODAY, weeks: 8 })}
  metric={metric} testIDPrefix={PREFIX} formatValue={String} />);

it.each(['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight'] as const)(
  'maps clustered %s bars, numeric ticks and interpolated references consistently', metric => {
    const strength = metric === 'estimatedRM1' || metric === 'highestWeight';
    renderValues([100, 100, 105, 105, 110, 110], metric);
    const expected = strength ? [100 / 3, 50, 200 / 3] : [100 / 110 * 100, 105 / 110 * 100, 100];
    for (const [index, date] of [DATES[0], DATES[2], TODAY].entries()) {
      expect(percentage(`bars-heatmap-bar-${date}`, 'width')).toBeCloseTo(expected[index]);
    }
    const axis = metric === 'workingSetCount' ? [['median', 105] as const] : [['p25', 101.25], ['median', 105], ['p75', 108.75]] as const;
    for (const [id, value] of axis) {
      const coordinate = strength ? 50 + (value - 105) / 15 * 50 : value / 110 * 100;
      expect(percentage(`bars-heatmap-${id}`, 'left')).toBeCloseTo(coordinate);
    }
    expect(screen.queryByTestId('bars-heatmap-axis')).toBeNull();
    const median = strength ? 50 : 105 / 110 * 100;
    expect(percentage('bars-heatmap-median', 'left')).toBeCloseTo(median);
    expect(screen.getByTestId('bars-heatmap-median')).toHaveProp('accessibilityLabel', '9-week median 105');
    if (metric === 'workingSetCount') {
      expect(screen.queryByTestId('bars-heatmap-p25')).toBeNull();
      expect(screen.queryByTestId('bars-heatmap-p75')).toBeNull();
    } else {
      expect(screen.getByTestId('bars-heatmap-p25')).toHaveProp('accessibilityLabel', '9-week 25th percentile 101.25');
      expect(screen.getByTestId('bars-heatmap-p75')).toHaveProp('accessibilityLabel', '9-week 75th percentile 108.75');
      expect(percentage('bars-heatmap-p25', 'left')).toBeCloseTo(strength ? 37.5 : 101.25 / 110 * 100);
      expect(percentage('bars-heatmap-p75', 'left')).toBeCloseTo(strength ? 62.5 : 108.75 / 110 * 100);
    }
  });

it.each(['estimatedRM1', 'highestWeight'] as const)('centres short %s samples with symmetric padding', metric => {
  const { unmount } = renderValues([100, 110, 120], metric);
  for (const [index, value] of [100, 110, 120].entries()) {
    expect(percentage(`bars-heatmap-bar-${DATES[index]}`, 'width')).toBeCloseTo(25 + index * 25);
    expect(percentage(`bars-heatmap-axis-tick-${value}`, 'left')).toBeCloseTo(25 + index * 25);
  }
  expect(screen.queryByTestId('bars-heatmap-median')).toBeNull();
  unmount();
  renderValues([100, 110, 150], metric);
  for (const [index, value] of [100, 110, 150].entries()) {
    expect(percentage(`bars-heatmap-bar-${DATES[index]}`, 'width')).toBeCloseTo([37.5, 50, 100][index]);
    expect(percentage(`bars-heatmap-axis-tick-${value}`, 'left')).toBeCloseTo([37.5, 50, 100][index]);
  }
  expect(screen.queryByTestId('bars-heatmap-axis-tick-125')).toBeNull();
});

it.each(['estimatedRM1', 'highestWeight'] as const)('preserves symmetry for skewed %s with a negative lower boundary', metric => {
  renderValues([1, 2, 100], metric);
  expect(percentage(`bars-heatmap-bar-${DATES[0]}`, 'width')).toBeCloseTo(50 - 50 / 98);
  expect(percentage('bars-heatmap-axis-tick-2', 'left')).toBe(50);
  expect(percentage(`bars-heatmap-bar-${DATES[2]}`, 'width')).toBe(100);
});

it.each(['totalVolume', 'workingSetCount'] as const)('uses the actual maximum for fractional %s', metric => {
  renderValues([.25, .5, .75], metric);
  for (const [index, value] of [100 / 3, 200 / 3, 100].entries()) {
    expect(percentage(`bars-heatmap-bar-${DATES[index]}`, 'width')).toBeCloseTo(value);
  }
  expect(percentage('bars-heatmap-axis-tick-0', 'left')).toBe(0);
  expect(percentage('bars-heatmap-axis-tick-0.375', 'left')).toBe(50);
  expect(percentage('bars-heatmap-axis-tick-0.75', 'left')).toBe(100);
});

it.each(['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight'] as const)(
  'keeps extreme finite %s readings and ticks finite, including constant and tiny values', metric => {
    const strength = metric === 'estimatedRM1' || metric === 'highestWeight';
    const { unmount } = renderValues([Number.MAX_VALUE / 2, Number.MAX_VALUE], metric);
    expect(percentage(`bars-heatmap-bar-${DATES[0]}`, 'width')).toBeCloseTo(strength ? 50 - .25 / .3 * 50 : 50);
    expect(percentage(`bars-heatmap-bar-${DATES[1]}`, 'width')).toBeCloseTo(strength ? 50 + .25 / .3 * 50 : 100);
    for (const tick of screen.getAllByTestId(/^bars-heatmap-axis-tick-/)) {
      expect(Number.isFinite(Number.parseFloat(StyleSheet.flatten(tick.props.style).left))).toBe(true);
      expect(tick.props.accessibilityLabel).not.toMatch(/Infinity|NaN/);
    }
    unmount();
    const constant = renderValues(Array(6).fill(Number.MAX_VALUE), metric);
    expect(percentage('bars-heatmap-median', 'left')).toBe(strength ? 50 : 100);
    expect(percentage(`bars-heatmap-bar-${TODAY}`, 'width')).toBe(strength ? 50 : 100);
    constant.unmount();
    renderValues([Number.MIN_VALUE], metric);
    expect(percentage(`bars-heatmap-bar-${DATES[0]}`, 'width')).toBe(strength ? 50 : 100);
  });

it.each([15, 52])('uses the full %i-week history for displayed weeks and references, then follows a shorter window', weeks => {
  const days = [
    day('2025-01-06', 10000), // outside both saved windows
    day('2026-06-29', 1000), // inside the long window, older than twelve weeks
    ...['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10'].map((date, index) => day(date, index * 10)),
    day('2026-09-21', null), day('2026-09-28', 100), day(TODAY, 200),
  ];
  const { rerender } = render(chart(data(days, weeks)));
  expect(screen.UNSAFE_getByType(FlatList).props.data).toHaveLength(weeks === 15 ? 16 : 27);
  expect(screen.getByTestId('bars-heatmap-median')).toHaveProp('accessibilityLabel', `${weeks + 1}-week median 30`);
  expect(style('bars-heatmap-median').left).toBe('3%');
  expect(Number.parseFloat(style('bars-heatmap-p25').left)).toBeCloseTo(1.5);
  expect(Number.parseFloat(style('bars-heatmap-p75').left)).toBeCloseTo(15);

  rerender(chart(data(days, 12)));
  expect(screen.UNSAFE_getByType(FlatList).props.data).toHaveLength(13);
  expect(screen.getByTestId('bars-heatmap-median')).toHaveProp('accessibilityLabel', '13-week median 25');
  expect(style('bars-heatmap-median').left).toBe('12.5%');
  expect(style('bars-heatmap-p25').left).toBe('6.25%');
  expect(style('bars-heatmap-p75').left).toBe('41.25%');
});

it('counts eligible older training weeks across the saved window and omits references when excluded', () => {
  const dates = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06'];
  const days = dates.map((date, index) => day(date, index * 20));
  const { rerender } = render(chart(data(days, 52)));
  expect(screen.getByTestId('bars-heatmap-median')).toHaveProp('accessibilityLabel', '53-week median 50');
  expect(style('bars-heatmap-median').left).toBe('50%');
  rerender(chart(data(days, 12)));
  for (const id of ['median', 'p25', 'p75']) expect(screen.queryByTestId(`bars-heatmap-${id}`)).toBeNull();
});

it.each(['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight'] as const)(
  'keeps empty, all-zero, constant and short %s windows finite', metric => {
    for (const values of [[], [0, 0, 0, 0, 0, 0], [20, 20, 20, 20, 20, 20], [10]]) {
      const { unmount } = renderValues(values, metric);
      for (const bar of screen.queryAllByTestId(/^bars-heatmap-bar-/)) {
        const width = Number.parseFloat(StyleSheet.flatten(bar.props.style).width);
        expect(Number.isFinite(width)).toBe(true);
        expect(width).toBeGreaterThanOrEqual(0);
        expect(width).toBeLessThanOrEqual(100);
      }
      const positive = values.some(value => value > 0);
      const strength = metric === 'estimatedRM1' || metric === 'highestWeight';
      if (positive && values.length >= 6) expect(style('bars-heatmap-median').left).toBe(strength ? '50%' : '100%');
      else expect(screen.queryByTestId('bars-heatmap-median')).toBeNull();
      const ticks = screen.queryAllByTestId(/^bars-heatmap-axis-tick-/);
      expect(ticks).toHaveLength(positive && values.length >= 6 ? 0 : !positive || strength ? 1 : 3);
      if (!positive) expect(style('bars-heatmap-axis-tick-0').left).toBe('0%');
      else if (strength && values.length < 6) expect(style(`bars-heatmap-axis-tick-${values[0]}`).left).toBe('50%');
      unmount();
    }
  });

it('opens a training week, holds no selection, and announces the current week', () => {
  const open = jest.fn();
  render(chart(data([day(TODAY, 12), day('2026-09-28', 54)]), open));
  const week = screen.getByTestId('bars-heatmap-cell-2026-09-28');
  expect(week).toHaveProp('accessibilityRole', 'button');
  expect(week).toHaveProp('accessibilityHint', "Opens the week's sessions");
  expect(week.props.accessibilityState?.selected).toBeFalsy();
  fireEvent.press(week);
  expect(open).toHaveBeenCalledWith('2026-09-28');
  expect(style('bars-heatmap-bar-2026-09-28').borderWidth).toBeUndefined();
  expect(style('bars-heatmap-bar-2026-10-05')).not.toHaveProperty('borderWidth');
  expect(screen.queryByText('Current week')).toBeNull();
  expect(screen.getByTestId('bars-heatmap-cell-2026-10-05').props.accessibilityLabel).toContain('Current week');
});

it('retains blank, non-interactive rest weeks alongside zero and unavailable training', () => {
  const open = jest.fn();
  render(chart(data([day(TODAY, 0), day('2026-09-28', null)]), open));
  expect(screen.getByTestId('bars-heatmap-value-2026-10-05')).toHaveTextContent(/^0$/);
  expect(style('bars-heatmap-bar-2026-10-05').width).toBe('0%');
  expect(screen.getByTestId('bars-heatmap-value-2026-09-28')).toHaveTextContent('', { exact: true });
  expect(screen.getByTestId('bars-heatmap-value-2026-09-21')).toHaveTextContent('', { exact: true });
  expect(screen.queryByText('Rest')).toBeNull();
  expect(screen.getByTestId('bars-heatmap-cell-2026-09-21')).toHaveProp('accessibilityLabel', 'Week of 21-09-2026, Rest week');
  expect(screen.getByTestId('bars-heatmap-cell-2026-09-21')).toHaveProp('accessibilityRole', 'text');
  expect(screen.getByTestId('bars-heatmap-cell-2026-09-21').props.onPress).toBeUndefined();
  expect(screen.getByTestId('bars-heatmap-cell-2026-09-28').props.accessibilityLabel).toBe('Week of 28-09-2026, Volume unavailable');
  expect(screen.queryByText(/\?/)).toBeNull();
  expect(style('bars-heatmap-bar-2026-09-28')).toMatchObject({ backgroundColor: 'transparent', width: '0%' });
  // Both zero and unavailable training still open their sessions.
  fireEvent.press(screen.getByTestId('bars-heatmap-cell-2026-10-05'));
  expect(open).toHaveBeenCalledWith('2026-10-05');
  fireEvent.press(screen.getByTestId('bars-heatmap-cell-2026-09-28'));
  expect(open).toHaveBeenCalledWith('2026-09-28');
});

it('retains target colour independently of length and bounds long formatted values', () => {
  const loaded = buildHeatmapData([
    { ...day(TODAY, 8), workingSetCountsByMuscle: { quads: 8 } },
    { ...day('2026-09-28', 16), workingSetCountsByMuscle: { quads: 16 } },
  ], 'workingSetCount', { todayDateKey: TODAY, weeks: 2, muscleTargets: { muscleIds: ['quads'], weeklyTarget: 8 } });
  render(<WeeklyHeatmap data={loaded} metric="workingSetCount" testIDPrefix={PREFIX} formatValue={value => `${value}000000000000000000`} />);
  expect(style('bars-heatmap-bar-2026-10-05')).toMatchObject({ width: '50%', backgroundColor: uiRoles.viz4 });
  expect(style('bars-heatmap-bar-2026-09-28')).toMatchObject({ width: '100%', backgroundColor: uiRoles.viz4 });
  expect(style('bars-heatmap-value-2026-10-05')).toMatchObject({ textAlign: 'right' });
  expect(style('bars-heatmap-value-column-2026-10-05')).toEqual({ width: 96 });
  expect(screen.getByTestId('bars-heatmap-cell-2026-10-05').props.accessibilityLabel).toContain('100% of weekly muscle target');
  expect(screen.getByTestId('bars-heatmap-cell-2026-10-05').props.accessibilityLabel).not.toContain('averaged');
  // The ramp names the target and its ends; no sentence explains the colour.
  for (const text of ['% of target', '0%', '100%']) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.queryByText(/Less|More|Full colour|Colour:/)).toBeNull();
});

it('virtualizes a dense 520-week training window while initially rendering a small recent subset', () => {
  const loaded = data(data([], 520).weekly.map(week => day(week.weekStartDateKey, 12)), 520);
  render(chart(loaded));
  expect(screen.UNSAFE_getByType(FlatList).props.data).toHaveLength(521);
  expect(screen.getAllByTestId(/^bars-heatmap-cell-/).length).toBeLessThan(30);
  expect(screen.getAllByTestId(/^bars-heatmap-cell-/)[0]).toHaveProp('testID', 'bars-heatmap-cell-2026-10-05');
});

it('handles a truly empty adapter array without a reference or invalid scale', () => {
  render(chart({ daily: [], weekly: [], todayDateKey: TODAY }));
  expect(screen.queryByTestId('bars-heatmap-median')).toBeNull();
  expect(screen.queryAllByTestId(/^bars-heatmap-cell-/)).toEqual([]);
});

it.each([0, 3, 6])('omits repeated footer disclaimers with %i known training weeks', count => {
  const days = Array.from({ length: count }, (_, index) => day(new Date(Date.UTC(2026, 9, 5) - index * 7 * 86400000).toISOString().slice(0, 10), 20));
  render(chart(data(days)));
  expect(screen.queryByText('Current week is in progress.')).toBeNull();
  expect(screen.queryByText(/week average:/)).toBeNull();
  expect(screen.queryByText('Current week')).toBeNull();
  expect(screen.getByText('% of max')).toBeTruthy();
  if (count >= 6) expect(screen.getByTestId('bars-heatmap-median')).toHaveProp('accessibilityLabel', '9-week median 20');
  else expect(screen.queryByTestId('bars-heatmap-median')).toBeNull();
});

it('opens rows without a banner and uses one active vertical scroller', () => {
  const open = jest.fn();
  render(<HistoryView timeline={TIMELINE} kind="exercise" subject="Bench Press"
    metricOptions={EXERCISE_HISTORY_METRIC_OPTIONS} metric="totalVolume" onSelectMetric={jest.fn()}
    view="weekly" onSelectView={jest.fn()} lookbackWeeks={8} isLoading={false} errorMessage={null}
    onOpenWeek={open} todayDateKey={TODAY}
    dailyMetrics={[day('2026-09-28', null)]}
    weeklyEffort={[{ weekStartDateKey: '2026-09-28', totalVolume: null, workingSetCount: 2, estimatedRM1: null, highestWeight: null, monthKey: '2026-09', weekOfMonth: 5 }]} />);
  expect(screen.queryByTestId('stats-exercise-history-week-banner')).toBeNull();
  expect(screen.queryByText(/Tap a week/)).toBeNull();
  expect(screen.getByLabelText('Select history view')).toBeTruthy();
  expect(screen.getByTestId('stats-exercise-history-heatmap-panel-daily', { includeHiddenElements: true })).toHaveProp('pointerEvents', 'none');
  const weekly = screen.UNSAFE_getByType(FlatList);
  expect(weekly.parent?.type).not.toBe(ScrollView);
  fireEvent.press(screen.getByTestId('stats-exercise-history-heatmap-cell-2026-09-28'));
  expect(open).toHaveBeenCalledWith('2026-09-28');
  expect(screen.queryByTestId('stats-exercise-history-week-banner')).toBeNull();
});

it.each(['loading', 'error', 'empty'])('keeps the %s state inline and offers only the relevant action', state => {
  const retry = jest.fn();
  render(<HistoryView timeline={TIMELINE} kind="exercise" subject="Bench Press"
    metricOptions={EXERCISE_HISTORY_METRIC_OPTIONS} metric="highestWeight" onSelectMetric={jest.fn()}
    view="weekly" onSelectView={jest.fn()} lookbackWeeks={1} isLoading={state === 'loading'}
    errorMessage={state === 'error' ? 'Read failed' : null}
    onRetry={retry} todayDateKey={TODAY}
    dailyMetrics={[]} weeklyEffort={[]} />);
  expect(screen.getByTestId(`stats-exercise-history-${state}`)).toBeTruthy();
  if (state !== 'empty') expect(screen.queryByTestId('stats-exercise-history-empty')).toBeNull();
  if (state === 'error') {
    expect(screen.queryByTestId('stats-exercise-history-heatmap-cell-2026-10-05')).toBeNull();
    fireEvent.press(screen.getByTestId('stats-exercise-history-retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  } else expect(screen.queryByTestId('stats-exercise-history-retry')).toBeNull();
  // The page is left by its native Back: nothing here draws a modal or a close.
  expect(screen.queryByTestId('stats-exercise-history-close')).toBeNull();
});

it('formats fractional Top weight references to one decimal without floating-point noise', () => {
  const dates = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', TODAY];
  render(<HistoryView timeline={TIMELINE} kind="exercise" subject="Bench Press"
    metricOptions={EXERCISE_HISTORY_METRIC_OPTIONS} metric="highestWeight" onSelectMetric={jest.fn()}
    view="weekly" onSelectView={jest.fn()} lookbackWeeks={6} isLoading={false} errorMessage={null}
    todayDateKey={TODAY} weeklyEffort={[]}
    dailyMetrics={dates.map((date, index) => ({ ...day(date, 1), highestWeight: index >= 4 ? 11 : 10 }))} />);
  expect(screen.getByTestId('stats-exercise-history-heatmap-median')).toHaveProp('accessibilityLabel', '7-week median 10.0');
  expect(screen.getByTestId('stats-exercise-history-heatmap-p25')).toHaveProp('accessibilityLabel', '7-week 25th percentile 10.0');
  expect(screen.getByTestId('stats-exercise-history-heatmap-p75')).toHaveProp('accessibilityLabel', '7-week 75th percentile 10.8');
  expect(screen.getByTestId(`stats-exercise-history-heatmap-value-${TODAY}`)).toHaveTextContent('11.0');
  expect(percentage('stats-exercise-history-heatmap-p75', 'left')).toBeCloseTo(87.5);
  expect(style('stats-exercise-history-heatmap-p25').left).toBe('50%');
  expect(style('stats-exercise-history-heatmap-median').left).toBe('50%');
});

it('retains coincident reference positions and announces all their values on the current week', () => {
  const dates = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', TODAY];
  render(chart(data(dates.map(date => day(date, 20)))));
  for (const [id, description] of [['p25', '25th percentile'], ['median', 'median'], ['p75', '75th percentile']]) {
    expect(screen.getByTestId(`bars-heatmap-${id}`)).toHaveProp('accessibilityLabel', `9-week ${description} 20`);
    expect(style(`bars-heatmap-${id}`).left).toBe('100%');
    expect(screen.getByTestId(`bars-heatmap-cell-${TODAY}`).props.accessibilityLabel).toContain(`${description} 20`);
  }
  expect(screen.queryByText(/P\d+|Median/)).toBeNull();
  expect(screen.queryByTestId('bars-heatmap-average')).toBeNull();
  expect(screen.queryByText(/Volume.*per week/)).toBeNull();
});

it.each(['muscle', 'exercise'] as const)('shows only the current-week Sets median for %s history', kind => {
  const dates = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', TODAY];
  render(<HistoryView timeline={TIMELINE} kind={kind} subject="Training"
    metricOptions={EXERCISE_HISTORY_METRIC_OPTIONS} metric="workingSetCount" onSelectMetric={jest.fn()}
    view="weekly" onSelectView={jest.fn()} lookbackWeeks={6} isLoading={false} errorMessage={null}
    todayDateKey={TODAY} weeklyEffort={[]}
    dailyMetrics={dates.map((date, index) => day(date, index * 2))} />);
  const prefix = `stats-${kind}-history`;
  expect(screen.getByTestId(`${prefix}-heatmap-median`)).toHaveProp('accessibilityLabel', '7-week median 5.0');
  expect(style(`${prefix}-heatmap-median`).left).toBe('50%');
  expect(screen.queryByTestId(`${prefix}-heatmap-p25`)).toBeNull();
  expect(screen.queryByTestId(`${prefix}-heatmap-p75`)).toBeNull();
  expect(screen.queryByTestId(`${prefix}-window`)).toBeNull();
  expect(screen.queryByText(/^(Metric|P\d+.*|Median.*)$/)).toBeNull();
  // The metric chip names the figure the bars and median show.
  expect(screen.getByTestId(`${prefix}-metric-chip-workingSetCount`)).toHaveTextContent('Sets');
});

it('excludes future observations from reference eligibility', () => {
  const loaded = data(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']
    .map(date => day(date, 20)));
  loaded.weekly.push({ ...loaded.weekly.at(-1)!, weekStartDateKey: '2026-10-12', value: 100, hasTraining: true });
  render(chart(loaded));
  expect(screen.queryByTestId('bars-heatmap-median')).toBeNull();
  expect(screen.queryByTestId('bars-heatmap-cell-2026-10-12')).toBeNull();
  expect(style(`bars-heatmap-bar-${DATES[0]}`).width).toBe('100%');
});

it('draws no view title in either view: the page title and selectors name what is shown', () => {
  const { unmount } = render(<HistoryView timeline={TIMELINE} kind="exercise" subject="Bench Press"
    metricOptions={EXERCISE_HISTORY_METRIC_OPTIONS} metric="totalVolume" onSelectMetric={jest.fn()}
    view="daily" onSelectView={jest.fn()} lookbackWeeks={8} isLoading={false} errorMessage={null}
    todayDateKey={TODAY} dailyMetrics={[day(TODAY, 20)]} weeklyEffort={[]} />);
  expect(screen.queryByText('Daily training load')).toBeNull();
  expect(screen.queryByText('Bench Press')).toBeNull();
  unmount();
  render(chart(data([day(TODAY, 20)])));
  expect(screen.queryByText('Weekly training load')).toBeNull();
});

it.each(['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight'] as const)(
  'includes genuine zeros in %s percentiles while drawing no zero fill', metric => {
    renderValues([0, 0, 0, 0, 100, 200], metric);
    const strength = metric === 'estimatedRM1' || metric === 'highestWeight';
    expect(screen.getByTestId(`bars-heatmap-value-${DATES[0]}`)).toHaveTextContent(/^0$/);
    expect(style(`bars-heatmap-bar-${DATES[0]}`).width).toBe('0%');
    expect(style('bars-heatmap-median').left).toBe(strength ? '50%' : '0%');
    expect(screen.getByTestId('bars-heatmap-median')).toHaveProp('accessibilityLabel', '9-week median 0');
    if (metric !== 'workingSetCount') {
      expect(style('bars-heatmap-p25').left).toBe(strength ? '50%' : '0%');
      expect(style('bars-heatmap-p75').left).toBe(strength ? '68.75%' : '37.5%');
    }
  });

it.each([
  ['exercise', 'workingSetCount'], ['muscle', 'workingSetCount'],
  ['exercise', 'totalVolume'], ['muscle', 'totalVolume'],
  ['exercise', 'estimatedRM1'], ['exercise', 'highestWeight'],
] as const)('passes the explicit %s %s identity through the shared history caller', (kind, metric) => {
  const strength = metric === 'estimatedRM1' || metric === 'highestWeight';
  const readings = strength ? [100, 100, 110, 110, 120, 150]
    : metric === 'totalVolume' ? [100, 200, 300, 400, 500, 2000]
    : kind === 'muscle' ? [.5, 1, 1.5, 2, 2.5, 10] : [1, 2, 3, 4, 5, 20];
  render(<HistoryView timeline={TIMELINE} kind={kind} subject="Training"
    metricOptions={kind === 'muscle' ? MUSCLE_HISTORY_METRIC_OPTIONS : EXERCISE_HISTORY_METRIC_OPTIONS}
    metric={metric} onSelectMetric={jest.fn()} view="weekly" onSelectView={jest.fn()}
    lookbackWeeks={8} isLoading={false} errorMessage={null} todayDateKey={TODAY}
    dailyMetrics={readings.map((value, index) => day(DATES[index], value))} weeklyEffort={[]} />);
  const prefix = `stats-${kind}-history-heatmap`;
  expect(percentage(`${prefix}-bar-${DATES[0]}`, 'width')).toBeCloseTo(strength ? 37.5 : 5);
  expect(style(`${prefix}-bar-${TODAY}`).width).toBe('100%');
  expect(style(`${prefix}-median`).left).toBe(strength ? '50%' : '17.5%');
  if (kind === 'muscle' && metric === 'workingSetCount') {
    expect(screen.getByTestId(`${prefix}-value-${DATES[0]}`)).toHaveTextContent(/^0.5$/);
    expect(screen.getByTestId(`${prefix}-median`)).toHaveProp('accessibilityLabel', '9-week median 1.8');
  }
  if (metric === 'workingSetCount') {
    expect(screen.queryByTestId(`${prefix}-p25`)).toBeNull();
    expect(screen.queryByTestId(`${prefix}-p75`)).toBeNull();
  } else {
    expect(percentage(`${prefix}-p25`, 'left')).toBeCloseTo(strength ? 40.625 : 11.25);
    expect(percentage(`${prefix}-p75`, 'left')).toBeCloseTo(strength ? 59.375 : 23.75);
  }
});

const layoutAxis = (plotWidth: number, labels: [number, number][]) => {
  const layout = (width: number) => ({ nativeEvent: { layout: { width, height: 16, x: 0, y: 0 } } });
  fireEvent(screen.getByTestId('bars-heatmap-axis'), 'layout', layout(plotWidth));
  for (const [value, width] of labels) {
    fireEvent(screen.getByTestId(`bars-heatmap-axis-value-${value}`, { includeHiddenElements: true }), 'layout', layout(width));
  }
};

const layoutReferences = (plotWidth: number, labels: [string, number][]) => {
  const layout = (width: number) => ({ nativeEvent: { layout: { width, height: 56, x: 0, y: 0 } } });
  fireEvent(screen.getByTestId('bars-heatmap-annotations'), 'layout', layout(plotWidth));
  for (const [id, width] of labels) {
    fireEvent(screen.getByTestId(`bars-heatmap-annotation-${id}`, { includeHiddenElements: true }), 'layout', layout(width));
  }
};

it.each(['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight'] as const)(
  'labels only the current %s bar with percentile names and formatted values', metric => {
    const values = [10, 20, 30, 40, 50, 60];
    render(<WeeklyHeatmap
      data={buildHeatmapData(values.map((value, index) => day(DATES[index], value)), metric, { todayDateKey: TODAY, weeks: 8 })}
      metric={metric} testIDPrefix={PREFIX} formatValue={value => `row ${value}`}
      formatReferenceValue={value => value.toFixed(1)} />);
    const references = metric === 'workingSetCount' ? [['median', 35] as const]
      : [['p25', 22.5], ['median', 35], ['p75', 47.5]] as const;
    layoutReferences(240, references.map(([id]) => [id, 24]));
    expect(screen.queryByTestId('bars-heatmap-axis')).toBeNull();
    const current = screen.getByTestId(`bars-heatmap-cell-${TODAY}`);
    for (const [id, value] of references) {
      const labelID = `bars-heatmap-annotation-${id}`;
      const coordinate = percentage(`bars-heatmap-${id}`, 'left');
      const annotation = within(current).getByTestId(labelID, { includeHiddenElements: true });
      expect(annotation).toHaveTextContent(`${id === 'median' ? 'Median' : id.toUpperCase()}${value.toFixed(1)}`);
      expect(style(labelID).opacity).toBe(1);
      expect(style(labelID).transform[0].translateX + 12).toBeCloseTo(coordinate / 100 * 240);
      expect(current.props.accessibilityLabel).toContain(value.toFixed(1));
      for (const date of DATES.slice(0, -1)) {
        expect(within(screen.getByTestId(`bars-heatmap-cell-${date}`)).queryByTestId(`bars-heatmap-${id}`)).toBeNull();
      }
    }
    expect(screen.getByTestId(`bars-heatmap-value-${TODAY}`)).toHaveTextContent('row 60');
  });

it('fits the current annotation above and below the bar in the same compact row as every other week', () => {
  renderValues([10, 20, 30, 40, 50, 60], 'totalVolume');
  layoutReferences(240, [['p25', 24], ['median', 24], ['p75', 24]]);
  for (const key of DATES) {
    expect(style(`bars-heatmap-plot-row-${key}`).minHeight).toBe(52);
  }
  const annotations = screen.getByTestId('bars-heatmap-annotations');
  expect(StyleSheet.flatten(annotations.props.style).height).toBe(52);
  const annotation = screen.getByTestId('bars-heatmap-annotation-median', { includeHiddenElements: true });
  const [label, gap, value] = annotation.children;
  expect(typeof label === 'object' && StyleSheet.flatten(label.props.style).lineHeight).toBe(14);
  expect(typeof gap === 'object' && StyleSheet.flatten(gap.props.style).height).toBe(24);
  expect(typeof value === 'object' && StyleSheet.flatten(value.props.style).lineHeight).toBe(14);
  const track = screen.getByTestId(`bars-heatmap-track-${TODAY}`);
  const trackTop = StyleSheet.flatten(track.parent?.parent?.props.style).top;
  expect(trackTop).toBeGreaterThan(14);
  expect(trackTop + style(`bars-heatmap-track-${TODAY}`).height).toBeLessThan(38);
  expect(style('bars-heatmap-median').top).toBeLessThan(trackTop);
  expect(style('bars-heatmap-median').top + style('bars-heatmap-median').height).toBeGreaterThan(trackTop + 16);
});

it.each([
  [[0, 0, 0, 0, 100, 200], 0],
  [[1, 2, 3, 4, 5, 20], 17.5],
  [[20, 20, 20, 20, 20, 20], 100],
])('centres both median captions on the computed tick, including plot edges (%j)', (values, position) => {
  renderValues(values, 'totalVolume');
  layoutReferences(200, [['p25', 32], ['median', 48], ['p75', 32]]);
  const annotation = style('bars-heatmap-annotation-median');
  expect(annotation.opacity).toBe(1);
  expect(annotation.alignItems).toBe('center');
  expect(annotation.transform[0].translateX + 24).toBeCloseTo(position / 100 * 200);
  expect(percentage('bars-heatmap-median', 'left')).toBeCloseTo(position);
});

it('keeps the median label when quartile labels overlap, preserving every exact tick and spoken value', () => {
  renderValues([10, 20, 30, 40, 50, 60], 'estimatedRM1');
  layoutReferences(60, [['p25', 24], ['median', 24], ['p75', 24]]);
  expect(style('bars-heatmap-annotation-median').opacity).toBe(1);
  for (const [id, value] of [['p25', 22.5], ['p75', 47.5]] as const) {
    expect(style(`bars-heatmap-annotation-${id}`).opacity).toBe(0);
    expect(screen.getByTestId(`bars-heatmap-${id}`)).toBeTruthy();
    expect(screen.getByTestId(`bars-heatmap-cell-${TODAY}`).props.accessibilityLabel).toContain(String(value));
  }
});

it.each([100, 200])('uses measured text bounds and leaves marks fixed at a %i-point plot width', plotWidth => {
  renderValues([100, 110, 120], 'estimatedRM1');
  expect(style('bars-heatmap-axis-value-110').opacity).toBe(0);
  layoutAxis(plotWidth, [[100, 20], [110, 30], [120, 20]]);
  const visible = [100, 110, 120].filter(value => style(`bars-heatmap-axis-value-${value}`).opacity === 1);
  expect(visible).toEqual(plotWidth === 100 ? [110] : [100, 110, 120]);
  for (const [index, value] of [100, 110, 120].entries()) {
    const annotation = style(`bars-heatmap-axis-value-${value}`);
    const width = value === 110 ? 30 : 20;
    const left = annotation.transform[0].translateX;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + width).toBeLessThanOrEqual(plotWidth);
    expect(left + width / 2).toBeCloseTo(plotWidth * (25 + index * 25) / 100);
    expect(percentage(`bars-heatmap-axis-tick-${value}`, 'left')).toBeCloseTo(25 + index * 25);
  }
  for (let index = 1; index < visible.length; index++) {
    const left = style(`bars-heatmap-axis-value-${visible[index - 1]}`).transform[0].translateX;
    const width = visible[index - 1] === 110 ? 30 : 20;
    expect(style(`bars-heatmap-axis-value-${visible[index]}`).transform[0].translateX).toBeGreaterThan(left + width);
  }
});

it('bounds edge annotations, keeps the centre and exposes full long values on their ticks', () => {
  const format = (value: number) => `${value}00000000000000000000000000000000000000000000`;
  render(<WeeklyHeatmap data={data([day(TODAY, 1000)])} metric="totalVolume"
    testIDPrefix={PREFIX} formatValue={format} />);
  layoutAxis(100, [[0, 100], [500, 100], [1000, 100]]);
  for (const value of [0, 500, 1000]) {
    expect(style(`bars-heatmap-axis-value-${value}`)).toMatchObject({ maxWidth: 100, transform: [{ translateX: 0 }] });
    expect(screen.getByTestId(`bars-heatmap-axis-value-${value}`, { includeHiddenElements: true })).toHaveProp('numberOfLines', 1);
    expect(screen.getByTestId(`bars-heatmap-axis-tick-${value}`)).toHaveProp('accessibilityLabel', `Axis ${format(value)}`);
  }
  expect(style('bars-heatmap-axis-value-500').opacity).toBe(1);
  expect(style('bars-heatmap-axis-value-0').opacity).toBe(0);
  expect(style('bars-heatmap-axis-value-1000').opacity).toBe(0);
  layoutAxis(200, [[0, 30], [500, 30], [1000, 30]]);
  expect(style('bars-heatmap-axis-value-0').transform).toEqual([{ translateX: 0 }]);
  expect(style('bars-heatmap-axis-value-500').transform).toEqual([{ translateX: 85 }]);
  expect(style('bars-heatmap-axis-value-1000').transform).toEqual([{ translateX: 170 }]);
  for (const value of [0, 500, 1000]) expect(style(`bars-heatmap-axis-value-${value}`).opacity).toBe(1);
});

it('remeasures annotations when switching between strength and Volume, with no stale label positions', () => {
  const days = [100, 110, 120].map((value, index) => day(DATES[index], value));
  const strength = <WeeklyHeatmap data={buildHeatmapData(days, 'highestWeight', { todayDateKey: TODAY, weeks: 8 })}
    metric="highestWeight" formatValue={value => value.toFixed(1)} testIDPrefix={PREFIX} />;
  const { rerender } = render(strength);
  layoutAxis(200, [[100, 30], [110, 30], [120, 30]]);
  expect(style('bars-heatmap-axis-value-110')).toMatchObject({ opacity: 1, transform: [{ translateX: 85 }] });
  rerender(<WeeklyHeatmap data={data(days)} metric="totalVolume" formatValue={String} testIDPrefix={PREFIX} />);
  expect(style('bars-heatmap-axis-value-60').opacity).toBe(0);
  layoutAxis(200, [[0, 10], [60, 20], [120, 30]]);
  expect(style('bars-heatmap-axis-value-60')).toMatchObject({ opacity: 1, transform: [{ translateX: 90 }] });
  expect(style('bars-heatmap-axis-value-120').transform).toEqual([{ translateX: 170 }]);
  rerender(strength);
  expect(style('bars-heatmap-axis-value-110').opacity).toBe(0);
  layoutAxis(200, [[100, 30], [110, 30], [120, 30]]);
  expect(style('bars-heatmap-axis-value-110')).toMatchObject({ opacity: 1, transform: [{ translateX: 85 }] });
});

it.each(['estimatedRM1', 'highestWeight'] as const)('centres constant %s references, showing only the median label', metric => {
  renderValues(Array(6).fill(100), metric);
  layoutReferences(100, [['p25', 24], ['median', 24], ['p75', 24]]);
  expect(style('bars-heatmap-annotation-median')).toMatchObject({ opacity: 1, transform: [{ translateX: 38 }] });
  for (const [id, label] of [['p25', '25th percentile'], ['median', 'median'], ['p75', '75th percentile']]) {
    expect(style(`bars-heatmap-${id}`).left).toBe('50%');
    expect(screen.getByTestId(`bars-heatmap-cell-${TODAY}`).props.accessibilityLabel).toContain(`9-week ${label} 100`);
    if (id !== 'median') expect(style(`bars-heatmap-annotation-${id}`).opacity).toBe(0);
  }
});

it('bounds long percentile labels inside the plot without moving their ticks', () => {
  render(<WeeklyHeatmap data={data(DATES.map((date, index) => day(date, index * 100)))} metric="totalVolume"
    testIDPrefix={PREFIX} formatValue={String} formatReferenceValue={value => `${value}000000000000000000000000000000`} />);
  layoutReferences(40, [['p25', 40], ['median', 40], ['p75', 40]]);
  for (const id of ['p25', 'median', 'p75']) {
    expect(style(`bars-heatmap-annotation-${id}`)).toMatchObject({ maxWidth: 40, transform: [{ translateX: 0 }] });
  }
  expect(style('bars-heatmap-annotation-median').opacity).toBe(1);
  expect(style('bars-heatmap-p25').left).toBe('25%');
  expect(style('bars-heatmap-p75').left).toBe('75%');
});

it('collapses each empty month to one accessible row between occupied months', () => {
  const open = jest.fn();
  render(chart(data([day('2026-10-05', 20), day('2026-07-20', 10)], 16), open));
  expect(screen.getAllByTestId(/^bars-heatmap-empty-month-/).map(row => row.props.testID)).toEqual([
    'bars-heatmap-empty-month-2026-09', 'bars-heatmap-empty-month-2026-08', 'bars-heatmap-empty-month-2026-06',
  ]);
  const september = screen.getByTestId('bars-heatmap-empty-month-2026-09');
  expect(september).toHaveProp('accessibilityLabel', 'September 2026, No training');
  expect(september).toHaveProp('accessibilityRole', 'text');
  expect(within(september).getByText('September')).toHaveStyle({ fontSize: uiTypography.size.base });
  expect(within(september).getByText('2026')).toHaveStyle({ fontSize: uiTypography.size.sm, color: uiRoles.inkMuted });
  expect(september.props.onPress).toBeUndefined();
  expect(screen.queryByTestId('bars-heatmap-cell-2026-09-28')).toBeNull();
  expect(screen.queryByTestId('bars-heatmap-value-2026-09-28')).toBeNull();
  const rows = screen.UNSAFE_getByType(FlatList).props.data;
  expect(rows.map((row: { monthKey?: string; weekStartDateKey?: string }) => row.monthKey ?? row.weekStartDateKey)).toEqual([
    '2026-10-05', '2026-09', '2026-08', '2026-07-27', '2026-07-20', '2026-07-13', '2026-07-06', '2026-06',
  ]);
  fireEvent.press(screen.getByTestId('bars-heatmap-cell-2026-07-20'));
  expect(open).toHaveBeenCalledWith('2026-07-20');
});

it.each([0, null])('keeps a Monday-owned month expanded for cross-month zero/unavailable training (%s)', value => {
  const loaded = data([day('2026-10-01', value)]);
  const { rerender } = render(chart(loaded));
  expect(screen.queryByTestId('bars-heatmap-empty-month-2026-09')).toBeNull();
  expect(screen.getByTestId('bars-heatmap-cell-2026-09-07')).toBeTruthy();
  expect(screen.getByTestId('bars-heatmap-cell-2026-09-28').props.accessibilityLabel)
    .toContain(value === null ? 'Volume unavailable' : 'Volume 0');
  expect(screen.queryByTestId('bars-heatmap-empty-month-2026-10')).toBeNull();
  expect(screen.getByTestId(`bars-heatmap-cell-${TODAY}`)).toBeTruthy();
  rerender(chart(data([])));
  expect(screen.queryByTestId('bars-heatmap-cell-2026-09-28')).toBeNull();
  expect(screen.getByTestId('bars-heatmap-empty-month-2026-09')).toBeTruthy();
});

it('keeps the blank current week visible in an entirely empty window and collapses older months', () => {
  render(chart(data([])));
  expect(screen.getAllByTestId(/^bars-heatmap-cell-/).map(row => row.props.testID)).toEqual([`bars-heatmap-cell-${TODAY}`]);
  expect(screen.getByTestId(`bars-heatmap-cell-${TODAY}`)).toHaveProp('accessibilityRole', 'text');
  expect(screen.getByTestId(`bars-heatmap-value-${TODAY}`)).toHaveTextContent('', { exact: true });
  expect(style(`bars-heatmap-bar-${TODAY}`).width).toBe('0%');
  expect(screen.getAllByTestId(/^bars-heatmap-empty-month-/).map(row => row.props.testID)).toEqual([
    'bars-heatmap-empty-month-2026-09', 'bars-heatmap-empty-month-2026-08',
  ]);
  expect(screen.queryByTestId('bars-heatmap-median')).toBeNull();
});

it.each(['muscle', 'exercise'] as const)('keeps an untrained current %s week with references and fills it only after activity', kind => {
  const priorDates = ['2026-08-24', ...DATES.slice(0, -1)];
  const prior = priorDates.map((date, index) => day(date, (index + 1) * 10));
  const open = jest.fn();
  const view = (days: DailyEffortMetrics[]) => <HistoryView timeline={TIMELINE} kind={kind} subject="Training"
    metricOptions={kind === 'muscle' ? MUSCLE_HISTORY_METRIC_OPTIONS : EXERCISE_HISTORY_METRIC_OPTIONS}
    metric="totalVolume" onSelectMetric={jest.fn()} view="weekly" onSelectView={jest.fn()}
    lookbackWeeks={8} isLoading={false} errorMessage={null} todayDateKey={TODAY}
    dailyMetrics={days} weeklyEffort={[]} onOpenWeek={open} />;
  const { rerender } = render(view(prior));
  const prefix = `stats-${kind}-history-heatmap`;
  expect(screen.getByTestId(`${prefix}-cell-${TODAY}`)).toHaveProp('accessibilityRole', 'text');
  expect(screen.getByTestId(`${prefix}-cell-${TODAY}`).props.accessibilityLabel).toContain('Rest week, Current week');
  expect(screen.getByTestId(`${prefix}-value-${TODAY}`)).toHaveTextContent('', { exact: true });
  expect(style(`${prefix}-bar-${TODAY}`)).toMatchObject({ width: '0%', backgroundColor: 'transparent' });
  for (const id of ['p25', 'median', 'p75']) expect(screen.getByTestId(`${prefix}-${id}`)).toBeTruthy();
  fireEvent.press(screen.getByTestId(`${prefix}-cell-${TODAY}`));
  expect(open).not.toHaveBeenCalled();
  rerender(view([...prior, day(TODAY, 30)]));
  expect(screen.getByTestId(`${prefix}-value-${TODAY}`)).toHaveTextContent('30');
  expect(style(`${prefix}-bar-${TODAY}`).width).toBe('50%');
  fireEvent.press(screen.getByTestId(`${prefix}-cell-${TODAY}`));
  expect(open).toHaveBeenCalledWith(TODAY);
});
