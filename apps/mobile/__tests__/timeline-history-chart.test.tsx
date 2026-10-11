import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { TimelineHeatmap, buildHeatmapData } from '@/components/heatmaps';
import { Text } from 'react-native';
import { Path } from 'react-native-svg';

import { MIN_TIMELINE_COLUMN_WIDTH } from '@/components/heatmaps/timeline';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui';
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
const UNITS: Record<CalendarHeatmapMetric, (value: number) => string> = {
  totalVolume: () => 'volume', workingSetCount: value => value === 1 ? 'set' : 'sets', estimatedRM1: () => 'kg', highestWeight: () => 'kg',
};
const barFill = (id: string) => screen.UNSAFE_getAllByType(Path).find(mark => mark.props.testID === id)?.props.fill;

const chart = ({ metric = 'totalVolume', weeks = 4, selectedWeekKey = null, onSelectWeek = jest.fn(), days = DAYS, children }: {
  metric?: CalendarHeatmapMetric; weeks?: number; selectedWeekKey?: string | null;
  onSelectWeek?: (key: string) => void; days?: DailyEffortMetrics[];
  children?: React.ReactNode;
} = {}) => <TimelineHeatmap data={buildHeatmapData(days, metric, { todayDateKey: TODAY, weeks })} metric={metric}
  selectedWeekKey={selectedWeekKey} onSelectWeek={onSelectWeek} testIDPrefix="history"
  formatValue={metric === 'totalVolume' || metric === 'workingSetCount' ? String : (value: number) => value.toFixed(1)} metricLabel={metric === 'totalVolume' ? 'Volume' : '1RM'} unitLabel={UNITS[metric]}>
  {children}
</TimelineHeatmap>;

it('draws a zero-based column per trained week on a y scale with no unit label over it', () => {
  render(chart());
  expect(screen.getByTestId(`${ID}-bar-2026-09-14`)).toBeTruthy();
  expect(screen.getByTestId(`${ID}-bar-2026-09-28`)).toBeTruthy();
  expect(screen.queryByTestId(`${ID}-bar-2026-09-21`)).toBeNull();
  // The newest week is the focused one until another is selected.
  expect(barFill(`${ID}-bar-2026-10-05`)).toBe(uiRoles.ink);
  expect(hidden(`${ID}-tick-0`)).toHaveTextContent('0');
  expect(hidden(`${ID}-tick-400`)).toHaveTextContent('400');
  expect(screen.queryByTestId(`${ID}-unit`, { includeHiddenElements: true })).toBeNull();
});

it('draws 1RM as columns too, its whole ticks without a decimal', () => {
  const { rerender } = render(chart({ metric: 'estimatedRM1', days: [day('2026-10-05', { estimatedRM1: 9 })] }));
  expect(hidden(`${ID}-tick-2.5`)).toHaveTextContent('2.5');
  expect(hidden(`${ID}-tick-5`)).toHaveTextContent('5');
  rerender(chart({ metric: 'estimatedRM1' }));
  expect(screen.getAllByTestId(/history-timeline-bar-/)).toHaveLength(3);
  expect(hidden(`${ID}-tick-100`)).toHaveTextContent('100');
});

it('fills the selected column in ink, so a full column still shows it', () => {
  render(chart({ selectedWeekKey: '2026-09-14' }));
  expect(barFill(`${ID}-bar-2026-09-14`)).toBe(uiRoles.ink);
  expect(barFill(`${ID}-bar-2026-09-28`)).toBe(uiRoles.viz4);
});

it('marks the week it reads out, selected or not, so the two never disagree', () => {
  const { rerender } = render(chart());
  expect(hidden(`${ID}-readout-week`)).toHaveTextContent('5 – 11 Oct');
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('100 volume');
  expect(screen.getByText('Current week', { includeHiddenElements: true })).toBeTruthy();
  // The newest of the five 60pt columns, with nothing selected.
  expect(screen.getByTestId(`${ID}-selected`)).toHaveProp('x', 240);

  rerender(chart({ selectedWeekKey: '2026-09-14' }));
  expect(hidden(`${ID}-readout-week`)).toHaveTextContent('14 – 20 Sep');
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('400 volume');
  expect(screen.getByTestId(`${ID}-selected`)).toHaveProp('x', 60);
});

it('draws the focused week as the readout\'s heading, in the display face', () => {
  render(chart());
  expect(hidden(`${ID}-readout-week`)).toHaveStyle({ fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.lg });
});

it('steps to the previous and next week with the readout\'s arrows, stopping at the window\'s ends', () => {
  const onSelectWeek = jest.fn();
  // Opens on the newest week: there is no next one.
  const { rerender } = render(chart({ onSelectWeek }));
  expect(screen.getByTestId(`${ID}-next-week`)).toBeDisabled();
  expect(screen.getByTestId(`${ID}-previous-week`)).toBeEnabled();
  fireEvent.press(screen.getByTestId(`${ID}-previous-week`));
  expect(onSelectWeek).toHaveBeenLastCalledWith('2026-09-28');

  rerender(chart({ onSelectWeek, selectedWeekKey: '2026-09-28' }));
  fireEvent.press(screen.getByTestId(`${ID}-next-week`));
  expect(onSelectWeek).toHaveBeenLastCalledWith('2026-10-05');

  // The oldest week in the window: there is no previous one.
  rerender(chart({ onSelectWeek, selectedWeekKey: '2026-09-07' }));
  expect(screen.getByTestId(`${ID}-previous-week`)).toBeDisabled();
  fireEvent.press(screen.getByTestId(`${ID}-previous-week`));
  expect(onSelectWeek).toHaveBeenCalledTimes(2);
});

it('reads a rest week as zero for a sum and as no sets for a best', () => {
  const { rerender } = render(chart({ selectedWeekKey: '2026-09-21' }));
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('0 volume');
  expect(screen.getByTestId(`${ID}-plot`)).toHaveProp('accessibilityValue', { text: 'Week of 21 – 27 Sep 2026, Volume 0' });

  rerender(chart({ metric: 'estimatedRM1', selectedWeekKey: '2026-09-21' }));
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('No sets');
  expect(screen.getByTestId(`${ID}-plot`)).toHaveProp('accessibilityValue', { text: 'Week of 21 – 27 Sep 2026, 1RM No sets' });
});

it('speaks a unit that differs from the metric', () => {
  render(chart({ metric: 'estimatedRM1' }));
  expect(screen.getByTestId(`${ID}-plot`)).toHaveProp('accessibilityValue', { text: 'Week of 5 – 11 Oct 2026, 1RM 80.0 kg, Current week' });
});

it('reads an unavailable week as unavailable', () => {
  render(chart({ days: [day('2026-10-05', { totalVolume: null })] }));
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('Unavailable');
});

it('leaves View sessions to the page: the chart holds no button for it', () => {
  render(chart());
  expect(screen.queryByText('View sessions', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByTestId(`${ID}-view-sessions`, { includeHiddenElements: true })).toBeNull();
});

it('names one set in the singular', () => {
  render(chart({ metric: 'workingSetCount', days: [day('2026-10-05', { workingSetCount: 1 })] }));
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('1 set');
  expect(hidden(`${ID}-readout-value`)).not.toHaveTextContent('1 sets');
});

it('keeps the announced week on a VoiceOver double tap, which presses with no location', () => {
  const onSelectWeek = jest.fn();
  render(chart({ onSelectWeek, selectedWeekKey: '2026-09-14' }));
  // The announced week is already the focused one, so there is nothing to toggle.
  expect(screen.getByTestId(`${ID}-plot`).props.accessibilityActions)
    .toEqual([{ name: 'increment' }, { name: 'decrement' }]);
  fireEvent.press(screen.getByTestId(`${ID}-plot`), { nativeEvent: {} });
  expect(onSelectWeek).not.toHaveBeenCalled();
});

it('shows the week detail below the chart', () => {
  render(chart({ children: <Text testID="week-detail">sets</Text> }));
  expect(screen.getByTestId('week-detail')).toBeTruthy();
});

it('focuses the tapped week, and a second tap on it changes nothing', () => {
  const onSelectWeek = jest.fn();
  // Five rows over the 300pt fallback plot: 60pt columns.
  const { rerender } = render(chart({ onSelectWeek }));
  fireEvent.press(screen.getByTestId(`${ID}-plot`), { nativeEvent: { locationX: 190 } });
  expect(onSelectWeek).toHaveBeenLastCalledWith('2026-09-28');

  rerender(chart({ onSelectWeek, selectedWeekKey: '2026-09-28' }));
  fireEvent.press(screen.getByTestId(`${ID}-plot`), { nativeEvent: { locationX: 190 } });
  expect(onSelectWeek).toHaveBeenLastCalledWith('2026-09-28');
  expect(screen.getByTestId(`${ID}-selected`)).toHaveProp('x', 180);
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

it('keeps every week a tappable column, scrolling sideways once the window outgrows the plot', () => {
  const { rerender } = render(chart());
  expect(screen.getByTestId(`${ID}-scroll`)).toHaveProp('scrollEnabled', false);
  rerender(chart({ weeks: 104 }));
  expect(screen.getByTestId(`${ID}-scroll`)).toHaveProp('scrollEnabled', true);
  // 105 weeks at the 32pt floor rather than 2.9pt slivers: about a dozen of
  // them sit on the 300pt plot, and the rest are a swipe away.
  expect(screen.getByTestId(`${ID}-plot`)).toHaveStyle({ width: 105 * MIN_TIMELINE_COLUMN_WIDTH });
});

it('labels months at the first week starting in each, which wider columns all have room for', () => {
  render(chart({ weeks: 16 }));
  expect(screen.getByTestId(`${ID}-month-3`)).toHaveTextContent('Jul');
  expect(screen.getByText('2026')).toBeTruthy();
  expect(screen.getByTestId(`${ID}-month-7`)).toHaveTextContent('Aug');
  expect(screen.getByTestId(`${ID}-month-12`)).toHaveTextContent('Sep');
  expect(screen.getByTestId(`${ID}-month-16`)).toHaveTextContent('Oct');
});
