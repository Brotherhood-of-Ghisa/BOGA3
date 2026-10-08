import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { FlatList, Modal, ScrollView, StyleSheet } from 'react-native';

import { WeeklyHeatmap, buildHeatmapData } from '@/components/heatmaps';
import { HistorySheet, EXERCISE_HISTORY_METRIC_OPTIONS } from '@/components/stats/history-sheet';
import { uiGeometry, uiRoles } from '@/components/ui';
import type { DailyEffortMetrics } from '@/src/data';

const TODAY = '2026-10-05';
const PREFIX = 'bars';
const day = (dateKey: string, value: number | null): DailyEffortMetrics => ({
  dateKey, workingSetCount: value ?? 2, totalVolume: value,
  estimatedRM1: value, highestWeight: value,
});
const style = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);
const data = (days: DailyEffortMetrics[], weeks = 8) => buildHeatmapData(days, 'totalVolume', { todayDateKey: TODAY, weeks });
const chart = (loaded: ReturnType<typeof data>, selectedWeekKey: string | null = null, onSelectWeek: (key: string | null) => void = jest.fn()) =>
  <WeeklyHeatmap data={loaded} selectedWeekKey={selectedWeekKey} onSelectWeek={onSelectWeek} testIDPrefix={PREFIX} formatValue={String} metricLabel="Volume" />;

it('shows newest first, full week dates, aligned values and proportional zero-based lengths', () => {
  const loaded = data([day(TODAY, 12), day('2026-09-28', 54), day('2026-09-14', 60)]);
  const chronological = loaded.weekly.map(week => week.weekStartDateKey);
  render(chart(loaded));
  expect(screen.getAllByTestId(/^bars-heatmap-cell-/).map(row => row.props.testID)).toEqual([...chronological].reverse().map(key => `bars-heatmap-cell-${key}`));
  expect(loaded.weekly.map(week => week.weekStartDateKey)).toEqual(chronological);
  expect(screen.getByText('28 Sep – 4 Oct')).toBeTruthy();
  expect(style('bars-heatmap-bar-2026-10-05').width).toBe('20%');
  expect(style('bars-heatmap-bar-2026-09-28').width).toBe('90%');
  expect(style('bars-heatmap-bar-2026-09-14').width).toBe('100%');
  expect(screen.getByTestId('bars-heatmap-value-2026-09-28')).toHaveTextContent('54');
  expect(style('bars-heatmap-cell-2026-09-28').minHeight).toBeGreaterThanOrEqual(uiGeometry.tapTarget);
  expect(screen.UNSAFE_queryAllByType(ScrollView).every(view => !view.props.horizontal)).toBe(true);
});

it.each([15, 52])('uses the full %i-week history for displayed weeks and references, then follows a shorter window', weeks => {
  const days = [
    day('2025-01-06', 10000), // outside both saved windows
    day('2026-06-29', 1000), // inside the long window, older than twelve weeks
    ...['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10'].map((date, index) => day(date, index * 10)),
    day('2026-09-21', null), day('2026-09-28', 100), day(TODAY, 200),
  ];
  const { rerender } = render(chart(data(days, weeks)));
  expect(screen.UNSAFE_getByType(FlatList).props.data).toHaveLength(weeks);
  expect(screen.getByTestId('bars-heatmap-median')).toHaveProp('accessibilityLabel', `${weeks}-week median 30`);
  expect(style('bars-heatmap-median').left).toBe('3%');
  expect(Number.parseFloat(style('bars-heatmap-p25').left)).toBeCloseTo(1.5);
  expect(Number.parseFloat(style('bars-heatmap-p75').left)).toBeCloseTo(15);

  rerender(chart(data(days, 12)));
  expect(screen.UNSAFE_getByType(FlatList).props.data).toHaveLength(12);
  expect(screen.getByTestId('bars-heatmap-median')).toHaveProp('accessibilityLabel', '12-week median 25');
  expect(style('bars-heatmap-median').left).toBe('12.5%');
  expect(style('bars-heatmap-p25').left).toBe('6.25%');
  expect(style('bars-heatmap-p75').left).toBe('41.25%');
});

it('counts eligible older training weeks across the saved window and omits references when excluded', () => {
  const dates = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06'];
  const days = dates.map((date, index) => day(date, index * 20));
  const { rerender } = render(chart(data(days, 52)));
  expect(screen.getByTestId('bars-heatmap-median')).toHaveProp('accessibilityLabel', '52-week median 50');
  expect(style('bars-heatmap-median').left).toBe('50%');
  rerender(chart(data(days, 12)));
  for (const id of ['median', 'p25', 'p75']) expect(screen.queryByTestId(`bars-heatmap-${id}`)).toBeNull();
});

it.each([[], [0, 0, 0, 0, 0, 0], [20, 20, 20, 20, 20, 20], [10]].map(values => ({ values })))('keeps empty, zero, equal and short windows finite ($values)', ({ values }) => {
  const dates = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', TODAY];
  render(chart(data(values.map((value, index) => day(dates[index], value)))));
  for (const bar of screen.getAllByTestId(/^bars-heatmap-bar-/)) {
    const width = StyleSheet.flatten(bar.props.style).width;
    expect(Number.parseFloat(width)).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(width)).toBeLessThanOrEqual(100);
  }
  if (values.length >= 6 && values.some(value => value > 0)) {
    expect(style('bars-heatmap-median').left).toBe('100%');
  } else expect(screen.queryByTestId('bars-heatmap-median')).toBeNull();
});

it('distinguishes current, selected and current-selected weeks and clears on a second tap', () => {
  const loaded = data([day(TODAY, 12), day('2026-09-28', 54)]);
  function SelectedChart() {
    const [key, setKey] = useState<string | null>(null);
    return chart(loaded, key, setKey);
  }
  render(<SelectedChart />);
  expect(style('bars-heatmap-bar-2026-10-05')).not.toHaveProperty('borderWidth');
  fireEvent.press(screen.getByTestId('bars-heatmap-cell-2026-09-28'));
  expect(style('bars-heatmap-bar-2026-09-28').borderWidth).toBeUndefined();
  expect(screen.getByTestId('bars-heatmap-cell-2026-09-28')).toHaveProp('accessibilityState', { selected: true });
  expect(screen.getByTestId('bars-heatmap-selected-marker')).toBeTruthy();
  fireEvent.press(screen.getByTestId('bars-heatmap-cell-2026-09-28'));
  expect(screen.queryByTestId('bars-heatmap-selected-marker')).toBeNull();
  fireEvent.press(screen.getByTestId('bars-heatmap-cell-2026-10-05'));
  expect(style('bars-heatmap-bar-2026-10-05').borderWidth).toBeUndefined();
  expect(screen.getByText('Current week')).toBeTruthy();
  expect(screen.getByTestId('bars-heatmap-cell-2026-10-05').props.accessibilityLabel).toContain('Current week');
});

it('leaves rest and unavailable values blank, announces their distinction and retains known zero', () => {
  const select = jest.fn();
  render(chart(data([day(TODAY, 0), day('2026-09-28', null)]), '2026-09-28', select));
  expect(screen.getByTestId('bars-heatmap-value-2026-10-05')).toHaveTextContent(/^0$/);
  expect(screen.getByTestId('bars-heatmap-value-2026-09-28')).toHaveTextContent('', { exact: true });
  expect(screen.getByTestId('bars-heatmap-value-2026-09-21')).toHaveTextContent('', { exact: true });
  expect(screen.queryByText('Rest')).toBeNull();
  expect(screen.getByTestId('bars-heatmap-cell-2026-09-21').props.accessibilityLabel).toContain('Rest week');
  expect(screen.getByTestId('bars-heatmap-cell-2026-09-28').props.accessibilityLabel).toBe('Week of 2026-09-28, Volume unavailable');
  expect(screen.queryByText(/\?/)).toBeNull();
  expect(style('bars-heatmap-bar-2026-09-28')).toMatchObject({ backgroundColor: 'transparent', width: '0%' });
  expect(style('bars-heatmap-bar-2026-09-21')).toMatchObject({ backgroundColor: 'transparent', width: '0%' });
  fireEvent.press(screen.getByTestId('bars-heatmap-cell-2026-09-21'));
  expect(select).toHaveBeenCalledWith('2026-09-21');
});

it('retains target colour independently of length and bounds long formatted values', () => {
  const loaded = buildHeatmapData([
    { ...day(TODAY, 8), workingSetCountsByMuscle: { quads: 8 } },
    { ...day('2026-09-28', 16), workingSetCountsByMuscle: { quads: 16 } },
  ], 'workingSetCount', { todayDateKey: TODAY, weeks: 2, muscleTargets: { muscleIds: ['quads'], weeklyTarget: 8 } });
  render(<WeeklyHeatmap data={loaded} selectedWeekKey={null} onSelectWeek={jest.fn()} testIDPrefix={PREFIX} formatValue={value => `${value}000000000000000000`} />);
  expect(style('bars-heatmap-bar-2026-10-05')).toMatchObject({ width: '50%', backgroundColor: uiRoles.viz4 });
  expect(style('bars-heatmap-bar-2026-09-28')).toMatchObject({ width: '100%', backgroundColor: uiRoles.viz4 });
  expect(style('bars-heatmap-value-2026-10-05')).toMatchObject({ width: 96, textAlign: 'right' });
  expect(screen.getByTestId('bars-heatmap-cell-2026-10-05').props.accessibilityLabel).toContain('100% of weekly muscle target');
  expect(screen.getByTestId('bars-heatmap-cell-2026-10-05').props.accessibilityLabel).not.toContain('averaged');
  // The ramp names the target and its ends; no sentence explains the colour.
  for (const text of ['Weekly target', '0%', '100%']) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.queryByText(/Less|More|Full colour|Colour:/)).toBeNull();
});

it('retains the complete 520-week window while initially rendering a small recent subset', () => {
  const loaded = data([day(TODAY, 12)], 520);
  render(chart(loaded));
  expect(screen.UNSAFE_getByType(FlatList).props.data).toHaveLength(520);
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
  expect(screen.getByText('Current week')).toBeTruthy();
  expect(screen.getByText('Intensity (per week)')).toBeTruthy();
  if (count >= 6) expect(screen.getByTestId('bars-heatmap-median')).toHaveProp('accessibilityLabel', '8-week median 20');
  else expect(screen.queryByTestId('bars-heatmap-median')).toBeNull();
});

it('selects rows without a banner and uses one active vertical scroller', () => {
  function SelectedSheet() {
    const [key, setKey] = useState<string | null>(null);
    return <HistorySheet kind="exercise" eyebrow="Exercise History" title="Bench Press"
      metricOptions={EXERCISE_HISTORY_METRIC_OPTIONS} metric="totalVolume" onSelectMetric={jest.fn()}
      view="weekly" lookbackWeeks={8} isLoading={false} errorMessage={null} onDismiss={jest.fn()}
      selectedWeekKey={key} onSelectWeek={setKey} todayDateKey={TODAY}
      dailyMetrics={[day('2026-09-28', null)]}
      weeklyEffort={[{ weekStartDateKey: '2026-09-28', totalVolume: null, workingSetCount: 2, estimatedRM1: null, highestWeight: null, monthKey: '2026-09', weekOfMonth: 5 }]} />;
  }
  render(<SelectedSheet />);
  expect(screen.queryByTestId('stats-exercise-history-week-banner')).toBeNull();
  expect(screen.queryByText(/Tap a week/)).toBeNull();
  expect(screen.queryByLabelText('Select heatmap view')).toBeNull();
  expect(screen.getByTestId('stats-exercise-history-heatmap-panel-daily', { includeHiddenElements: true })).toHaveProp('pointerEvents', 'none');
  const weekly = screen.UNSAFE_getByType(FlatList);
  expect(weekly.parent?.type).not.toBe(ScrollView);
  fireEvent.press(screen.getByTestId('stats-exercise-history-heatmap-cell-2026-09-28'));
  expect(screen.queryByTestId('stats-exercise-history-week-banner')).toBeNull();
  expect(screen.getByTestId('stats-exercise-history-heatmap-cell-2026-09-28')).toHaveProp('accessibilityState', { selected: true });
  fireEvent.press(screen.getByTestId('stats-exercise-history-heatmap-cell-2026-09-28'));
  expect(screen.queryByTestId('stats-exercise-history-week-banner')).toBeNull();
});

it.each(['loading', 'error', 'empty'])('keeps the %s state inline and offers only the relevant action', state => {
  const retry = jest.fn();
  const dismiss = jest.fn();
  render(<HistorySheet kind="exercise" eyebrow="Exercise History" title="Bench Press"
    metricOptions={EXERCISE_HISTORY_METRIC_OPTIONS} metric="highestWeight" onSelectMetric={jest.fn()}
    view="weekly" lookbackWeeks={1} isLoading={state === 'loading'} errorMessage={state === 'error' ? 'Read failed' : null}
    onRetry={retry} onDismiss={dismiss} selectedWeekKey={null} onSelectWeek={jest.fn()} todayDateKey={TODAY}
    dailyMetrics={[]} weeklyEffort={[]} />);
  expect(screen.getByTestId(`stats-exercise-history-${state}`)).toBeTruthy();
  if (state !== 'empty') expect(screen.queryByTestId('stats-exercise-history-empty')).toBeNull();
  if (state === 'error') {
    expect(screen.queryByTestId('stats-exercise-history-heatmap-cell-2026-10-05')).toBeNull();
    fireEvent.press(screen.getByTestId('stats-exercise-history-retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  } else expect(screen.queryByTestId('stats-exercise-history-retry')).toBeNull();
  // An iOS swipe has already taken the page sheet away: the host hears once,
  // and a late native dismissal of the swiped modal is not a second close.
  const swiped = screen.UNSAFE_getByType(Modal);
  fireEvent(swiped, 'requestClose');
  expect(dismiss).toHaveBeenCalledTimes(1);
  fireEvent(swiped, 'dismiss');
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it('formats fractional Top weight references to one decimal without floating-point noise', () => {
  const dates = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', TODAY];
  render(<HistorySheet kind="exercise" eyebrow="Exercise History" title="Bench Press"
    metricOptions={EXERCISE_HISTORY_METRIC_OPTIONS} metric="highestWeight" onSelectMetric={jest.fn()}
    view="weekly" lookbackWeeks={6} isLoading={false} errorMessage={null} onDismiss={jest.fn()}
    selectedWeekKey={null} onSelectWeek={jest.fn()} todayDateKey={TODAY} weeklyEffort={[]}
    dailyMetrics={dates.map((date, index) => ({ ...day(date, 1), highestWeight: index >= 4 ? 11 : 10 }))} />);
  expect(screen.getByTestId('stats-exercise-history-heatmap-median')).toHaveProp('accessibilityLabel', '6-week median 10.0');
  expect(screen.getByTestId('stats-exercise-history-heatmap-p25')).toHaveProp('accessibilityLabel', '6-week 25th percentile 10.0');
  expect(screen.getByTestId('stats-exercise-history-heatmap-p75')).toHaveProp('accessibilityLabel', '6-week 75th percentile 10.8');
  expect(screen.getByTestId(`stats-exercise-history-heatmap-value-${TODAY}`)).toHaveTextContent('11.0');
});

it('retains coincident reference positions and accessible values without visible labels', () => {
  const dates = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', TODAY];
  render(chart(data(dates.map(date => day(date, 20)))));
  for (const [id, description] of [['p25', '25th percentile'], ['median', 'median'], ['p75', '75th percentile']]) {
    expect(screen.getByTestId(`bars-heatmap-${id}`)).toHaveProp('accessibilityLabel', `8-week ${description} 20`);
    expect(style(`bars-heatmap-${id}`).left).toBe('100%');
    expect(style(`bars-heatmap-reference-${id}-${TODAY}`).left).toBe('100%');
  }
  expect(screen.queryByText(/P\d+|Median/)).toBeNull();
  expect(screen.queryByTestId('bars-heatmap-average')).toBeNull();
  expect(screen.queryByText(/Volume.*per week/)).toBeNull();
});

it.each(['muscle', 'exercise'] as const)('shows only the Sets median for %s history with no captions', kind => {
  const dates = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', TODAY];
  render(<HistorySheet kind={kind} eyebrow={`${kind} history`} title="Training"
    metricOptions={EXERCISE_HISTORY_METRIC_OPTIONS} metric="workingSetCount" onSelectMetric={jest.fn()}
    view="weekly" lookbackWeeks={6} isLoading={false} errorMessage={null} onDismiss={jest.fn()}
    selectedWeekKey={null} onSelectWeek={jest.fn()} todayDateKey={TODAY} weeklyEffort={[]}
    dailyMetrics={dates.map((date, index) => day(date, index * 2))} />);
  const prefix = `stats-${kind}-history`;
  expect(screen.getByTestId(`${prefix}-heatmap-median`)).toHaveProp('accessibilityLabel', '6-week median 5.0');
  expect(style(`${prefix}-heatmap-median`).left).toBe('50%');
  expect(screen.queryByTestId(`${prefix}-heatmap-p25`)).toBeNull();
  expect(screen.queryByTestId(`${prefix}-heatmap-p75`)).toBeNull();
  expect(screen.queryByTestId(`${prefix}-window`)).toBeNull();
  expect(screen.queryByText(/^(Metric|P\d+.*|Median.*)$/)).toBeNull();
  expect(screen.getByTestId(`${prefix}-metric-chip-workingSetCount`)).toHaveStyle({ backgroundColor: '#000000' });
  expect(screen.getByText('Sets')).toHaveStyle({ color: '#FFFFFF' });
});

it('excludes future observations from reference eligibility', () => {
  const loaded = data(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']
    .map(date => day(date, 20)));
  loaded.weekly.push({ ...loaded.weekly.at(-1)!, weekStartDateKey: '2026-10-12', value: 100, hasTraining: true });
  render(chart(loaded));
  expect(screen.queryByTestId('bars-heatmap-median')).toBeNull();
});

it('uses the same title typography for Daily and Weekly', () => {
  const { unmount } = render(<HistorySheet kind="exercise" eyebrow="Exercise History" title="Bench Press"
    metricOptions={EXERCISE_HISTORY_METRIC_OPTIONS} metric="totalVolume" onSelectMetric={jest.fn()}
    view="daily" lookbackWeeks={8} isLoading={false} errorMessage={null} onDismiss={jest.fn()}
    selectedWeekKey={null} onSelectWeek={jest.fn()} todayDateKey={TODAY} dailyMetrics={[day(TODAY, 20)]} weeklyEffort={[]} />);
  const daily = StyleSheet.flatten(screen.getByText('Daily training load').props.style);
  unmount();
  render(chart(data([day(TODAY, 20)])));
  const weekly = StyleSheet.flatten(screen.getByText('Weekly training load').props.style);
  for (const key of ['fontFamily', 'fontWeight', 'fontSize', 'lineHeight']) expect(weekly[key]).toBe(daily[key]);
});
