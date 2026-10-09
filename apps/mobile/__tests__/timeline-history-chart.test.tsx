import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { TimelineHeatmap, buildHeatmapData } from '@/components/heatmaps';
import { Circle, Path } from 'react-native-svg';

import { uiRoles } from '@/components/ui';
import type { CalendarHeatmapMetric, DailyEffortMetrics } from '@/src/data';

const TODAY = '2026-10-07';
const ID = 'history-timeline';
const day = (dateKey: string, over: Partial<DailyEffortMetrics> = {}): DailyEffortMetrics => ({
  dateKey, totalVolume: 100, workingSetCount: 2, estimatedRM1: 50, highestWeight: 40, ...over,
});
const DAYS = [
  day('2026-09-14', { totalVolume: 400, estimatedRM1: 100 }),
  day('2026-09-28', { totalVolume: 200, estimatedRM1: 90 }),
  day('2026-10-05', { totalVolume: 100, estimatedRM1: 80 }),
];

// The readout and tick labels are hidden from VoiceOver: the plot's adjustable value speaks for them.
const hidden = (id: string) => screen.getByTestId(id, { includeHiddenElements: true });
const svgProps = (type: 'path' | 'circle', id: string) => {
  const marks = type === 'path' ? screen.UNSAFE_getAllByType(Path) : screen.UNSAFE_getAllByType(Circle);
  return marks.find(mark => mark.props.testID === id)?.props;
};

const chart = ({ metric = 'totalVolume', weeks = 4, selectedWeekKey = null, onSelectWeek = jest.fn(), days = DAYS }: {
  metric?: CalendarHeatmapMetric; weeks?: number; selectedWeekKey?: string | null;
  onSelectWeek?: (key: string | null) => void; days?: DailyEffortMetrics[];
} = {}) => <TimelineHeatmap data={buildHeatmapData(days, metric, { todayDateKey: TODAY, weeks })} metric={metric}
  selectedWeekKey={selectedWeekKey} onSelectWeek={onSelectWeek} testIDPrefix="history" formatValue={String}
  metricLabel={metric === 'totalVolume' ? 'Volume' : '1RM'} unitLabel={metric === 'totalVolume' ? 'kg·reps' : 'kg'} />;

it('draws a zero-based column per trained week with its unit and y scale', () => {
  render(chart());
  expect(screen.getByTestId(`${ID}-bar-2026-09-14`)).toBeTruthy();
  expect(screen.getByTestId(`${ID}-bar-2026-09-28`)).toBeTruthy();
  expect(screen.queryByTestId(`${ID}-bar-2026-09-21`)).toBeNull();
  expect(svgProps('path', `${ID}-bar-2026-10-05`)?.fill).toBe(uiRoles.viz4);
  expect(screen.getByTestId(`${ID}-unit`)).toHaveTextContent('kg·reps');
  expect(hidden(`${ID}-tick-0`)).toHaveTextContent('0');
  expect(hidden(`${ID}-tick-400`)).toHaveTextContent('400');
  expect(screen.queryByTestId(`${ID}-line-0`)).toBeNull();
});

it('draws 1RM as a line broken at the rest week', () => {
  render(chart({ metric: 'estimatedRM1' }));
  expect(screen.getAllByTestId(/history-timeline-line-/)).toHaveLength(1);
  expect(screen.getByTestId(`${ID}-dot`)).toBeTruthy();
  expect(screen.queryByTestId(/history-timeline-bar-/)).toBeNull();
  expect(hidden(`${ID}-tick-80`)).toBeTruthy();
});

it('reads out the newest week until one is selected, then the selected week', () => {
  const { rerender } = render(chart());
  expect(hidden(`${ID}-readout-week`)).toHaveTextContent('5 – 11 Oct');
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('100 kg·reps');
  expect(screen.getByText('Current week', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByTestId(`${ID}-selected`)).toBeNull();

  rerender(chart({ selectedWeekKey: '2026-09-14' }));
  expect(hidden(`${ID}-readout-week`)).toHaveTextContent('14 – 20 Sep');
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('400 kg·reps');
  expect(screen.getByTestId(`${ID}-selected`)).toHaveProp('x', 0);
});

it('leaves a rest week blank in the readout and says so to VoiceOver', () => {
  render(chart({ selectedWeekKey: '2026-09-21' }));
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('');
  expect(screen.getByTestId(`${ID}-plot`)).toHaveProp('accessibilityValue', { text: 'Week of 21 – 27 Sep 2026, Rest week' });
});

it('marks the selected point of a line', () => {
  render(chart({ metric: 'estimatedRM1', selectedWeekKey: '2026-09-28' }));
  expect(svgProps('circle', `${ID}-selected-dot`)?.fill).toBe(uiRoles.ink);
});

it('selects the tapped week and clears it on a second tap', () => {
  const onSelectWeek = jest.fn();
  // Four weeks over the 300pt fallback plot: 75pt columns.
  const { rerender } = render(chart({ onSelectWeek }));
  fireEvent.press(screen.getByTestId(`${ID}-plot`), { nativeEvent: { locationX: 160 } });
  expect(onSelectWeek).toHaveBeenLastCalledWith('2026-09-28');

  rerender(chart({ onSelectWeek, selectedWeekKey: '2026-09-28' }));
  fireEvent.press(screen.getByTestId(`${ID}-plot`), { nativeEvent: { locationX: 160 } });
  expect(onSelectWeek).toHaveBeenLastCalledWith(null);
});

it('steps through weeks as an adjustable element', () => {
  const onSelectWeek = jest.fn();
  const { rerender } = render(chart({ onSelectWeek }));
  const plot = screen.getByTestId(`${ID}-plot`);
  expect(plot).toHaveProp('accessibilityRole', 'adjustable');
  expect(plot).toHaveProp('accessibilityValue', { text: 'Week of 5 – 11 Oct 2026, Volume 100, Current week' });
  fireEvent(plot, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  expect(onSelectWeek).not.toHaveBeenCalled(); // already the newest week
  fireEvent(plot, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
  expect(onSelectWeek).toHaveBeenLastCalledWith('2026-09-28');

  rerender(chart({ onSelectWeek, selectedWeekKey: '2026-09-14' }));
  fireEvent(screen.getByTestId(`${ID}-plot`), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  expect(onSelectWeek).toHaveBeenLastCalledWith('2026-09-21');
});

it('scrolls sideways only when the window outgrows the plot', () => {
  const { rerender } = render(chart());
  expect(screen.getByTestId(`${ID}-scroll`)).toHaveProp('scrollEnabled', false);
  rerender(chart({ weeks: 104 }));
  expect(screen.getByTestId(`${ID}-scroll`)).toHaveProp('scrollEnabled', true);
  expect(screen.getByTestId(`${ID}-plot`)).toHaveStyle({ width: 624 });
});

it('labels months at the first week starting in each, dropping one that would run off the end', () => {
  render(chart({ weeks: 16 }));
  expect(screen.getByTestId(`${ID}-month-2`)).toHaveTextContent('Jul');
  expect(screen.getByText('2026')).toBeTruthy();
  expect(screen.getByTestId(`${ID}-month-11`)).toHaveTextContent('Sep');
  expect(screen.queryByTestId(`${ID}-month-15`)).toBeNull(); // Oct starts in the last 18.75pt column
});
