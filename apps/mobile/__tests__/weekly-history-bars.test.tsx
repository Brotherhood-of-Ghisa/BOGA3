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

it('averages only the latest twelve known training weeks, including zero and excluding unknown/rest', () => {
  const loaded = data([
    day('2026-06-29', 1000), // outside the recent twelve
    ...['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10'].map(date => day(date, 0)),
    day('2026-09-21', null), day('2026-09-28', 100), day(TODAY, 200),
  ], 15);
  render(chart(loaded));
  expect(screen.getByTestId('bars-heatmap-average-label')).toHaveProp('accessibilityLabel', '12-week average 50');
  // The older 1000 remains the window maximum; the recent mean shares that scale.
  expect(style('bars-heatmap-average').left).toBe('5%');
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
    expect(style('bars-heatmap-average').left).toBe('100%');
  } else expect(screen.queryByTestId('bars-heatmap-average')).toBeNull();
});

it('distinguishes current, selected and current-selected weeks and clears on a second tap', () => {
  const loaded = data([day(TODAY, 12), day('2026-09-28', 54)]);
  function SelectedChart() {
    const [key, setKey] = useState<string | null>(null);
    return chart(loaded, key, setKey);
  }
  render(<SelectedChart />);
  expect(style('bars-heatmap-bar-2026-10-05')).toMatchObject({ borderWidth: 1, borderColor: uiRoles.ink });
  fireEvent.press(screen.getByTestId('bars-heatmap-cell-2026-09-28'));
  expect(style('bars-heatmap-bar-2026-09-28').borderWidth).toBe(2);
  expect(screen.getByTestId('bars-heatmap-cell-2026-09-28')).toHaveProp('accessibilityState', { selected: true });
  expect(screen.getByTestId('bars-heatmap-selected-marker')).toBeTruthy();
  fireEvent.press(screen.getByTestId('bars-heatmap-cell-2026-09-28'));
  expect(screen.queryByTestId('bars-heatmap-selected-marker')).toBeNull();
  fireEvent.press(screen.getByTestId('bars-heatmap-cell-2026-10-05'));
  expect(style('bars-heatmap-bar-2026-10-05').borderWidth).toBe(2);
  expect(screen.getByText('Current week')).toBeTruthy();
  expect(screen.getByTestId('bars-heatmap-cell-2026-10-05').props.accessibilityLabel).toContain('Current week');
});

it('keeps rest, known-zero and unavailable training separate, tappable and unfilled', () => {
  const select = jest.fn();
  render(chart(data([day(TODAY, 0), day('2026-09-28', null)]), '2026-09-28', select));
  expect(screen.getByTestId('bars-heatmap-value-2026-10-05')).toHaveTextContent(/^0$/);
  expect(screen.getByTestId('bars-heatmap-value-2026-09-28')).toHaveTextContent('?');
  expect(screen.getByTestId('bars-heatmap-value-2026-09-21')).toHaveTextContent('Rest');
  expect(screen.getByTestId('bars-heatmap-cell-2026-09-28').props.accessibilityLabel).toContain('unavailable or incomplete');
  expect(style('bars-heatmap-bar-2026-09-28')).toMatchObject({ backgroundColor: 'transparent', borderWidth: 2 });
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
  expect(screen.queryByTestId('bars-heatmap-average')).toBeNull();
  expect(screen.queryAllByTestId(/^bars-heatmap-cell-/)).toEqual([]);
});

it.each([0, 3, 6])('omits repeated footer disclaimers with %i known training weeks', count => {
  const days = Array.from({ length: count }, (_, index) => day(new Date(Date.UTC(2026, 9, 5) - index * 7 * 86400000).toISOString().slice(0, 10), 20));
  render(chart(data(days)));
  expect(screen.queryByText('Current week is in progress.')).toBeNull();
  expect(screen.queryByText(/^12-week average:/)).toBeNull();
  expect(screen.getByText('Current week')).toBeTruthy();
  expect(screen.getByText('Intensity (per week)')).toBeTruthy();
  if (count >= 6) expect(screen.getByTestId('bars-heatmap-average-label')).toHaveTextContent('Avg 20');
  else expect(screen.queryByTestId('bars-heatmap-average-label')).toBeNull();
});

it('shows only the selected banner, preserves full coverage copy and uses one active vertical scroller', () => {
  function SelectedSheet() {
    const [key, setKey] = useState<string | null>(null);
    return <HistorySheet kind="exercise" eyebrow="Exercise History" title="Bench Press"
      metricOptions={EXERCISE_HISTORY_METRIC_OPTIONS} metric="totalVolume" onSelectMetric={jest.fn()}
      view="weekly" lookbackWeeks={8} isLoading={false} errorMessage={null} onDismiss={jest.fn()}
      selectedWeekKey={key} onSelectWeek={setKey} todayDateKey={TODAY}
      dailyMetrics={[{ ...day('2026-09-28', null), knownVolume: 40 }]}
      weeklyEffort={[{ weekStartDateKey: '2026-09-28', totalVolume: null, knownVolume: 40, workingSetCount: 2, estimatedRM1: null, highestWeight: null, monthKey: '2026-09', weekOfMonth: 5 }]} />;
  }
  render(<SelectedSheet />);
  expect(screen.queryByTestId('stats-exercise-history-week-banner')).toBeNull();
  expect(screen.queryByText(/Tap a week/)).toBeNull();
  expect(screen.queryByLabelText('Select heatmap view')).toBeNull();
  expect(screen.queryByTestId('stats-exercise-history-heatmap-panel-daily')).toBeNull();
  const weekly = screen.UNSAFE_getByType(FlatList);
  expect(weekly.parent?.type).not.toBe(ScrollView);
  fireEvent.press(screen.getByTestId('stats-exercise-history-heatmap-cell-2026-09-28'));
  expect(screen.getByTestId('stats-exercise-history-week-banner-range')).toHaveTextContent('28 Sept 2026 – 4 Oct 2026');
  expect(screen.getByTestId('stats-exercise-history-week-banner-value')).toHaveTextContent('Volume: 40 · incomplete');
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

it('formats fractional Top weight averages to one decimal without floating-point noise', () => {
  const dates = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', TODAY];
  render(<HistorySheet kind="exercise" eyebrow="Exercise History" title="Bench Press"
    metricOptions={EXERCISE_HISTORY_METRIC_OPTIONS} metric="highestWeight" onSelectMetric={jest.fn()}
    view="weekly" lookbackWeeks={6} isLoading={false} errorMessage={null} onDismiss={jest.fn()}
    selectedWeekKey={null} onSelectWeek={jest.fn()} todayDateKey={TODAY} weeklyEffort={[]}
    dailyMetrics={dates.map((date, index) => ({ ...day(date, 1), highestWeight: index === 5 ? 11 : 10 }))} />);
  expect(screen.getByTestId('stats-exercise-history-heatmap-average-label')).toHaveTextContent('Avg 10.2');
  expect(screen.getByTestId(`stats-exercise-history-heatmap-value-${TODAY}`)).toHaveTextContent('11.0');
});
