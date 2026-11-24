import React from 'react';
import { TimelineDetailsWindow } from '@/components/stats/timeline-details-window';
import { fireEvent, screen } from '@testing-library/react-native';

import { TimelineHeatmap, buildHeatmapData } from '@/components/heatmaps';
import { Text } from 'react-native';
import { Path } from 'react-native-svg';

import { MIN_TIMELINE_COLUMN_WIDTH } from '@/components/heatmaps/timeline';
import { resizeTimelineWindow, stepTimelineZoom } from '@/components/heatmaps/timeline-window';
import { uiFonts, uiTypography } from '@/components/ui';
import type { CalendarHeatmapMetric, DailyEffortMetrics } from '@/src/data';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';
import { renderWithTheme, rolesFor } from './helpers/theme';

const roles = rolesFor(DEFAULT_APPEARANCE);

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

const chart = ({ metric = 'totalVolume', weeks = 4, selectedWeekKey = null, onSelectWeek = jest.fn(), days = DAYS, children, display }: {
  metric?: CalendarHeatmapMetric; weeks?: number; selectedWeekKey?: string | null;
  onSelectWeek?: (key: string) => void; days?: DailyEffortMetrics[];
  children?: React.ReactNode; display?: React.ComponentProps<typeof TimelineHeatmap>['display'];
} = {}) => <TimelineHeatmap data={buildHeatmapData(days, metric, { todayDateKey: TODAY, weeks })} metric={metric}
  selectedWeekKey={selectedWeekKey} onSelectWeek={onSelectWeek} testIDPrefix="history" display={display}
  formatValue={metric === 'totalVolume' || metric === 'workingSetCount' ? String : (value: number) => value.toFixed(1)} metricLabel={metric === 'totalVolume' ? 'Volume' : '1RM'} unitLabel={UNITS[metric]}>
  {children}
</TimelineHeatmap>;

it('draws a zero-based column per trained week on a y scale with no unit label over it', () => {
  renderWithTheme(chart());
  expect(screen.getByTestId(`${ID}-bar-2026-09-14`)).toBeTruthy();
  expect(screen.getByTestId(`${ID}-bar-2026-09-28`)).toBeTruthy();
  expect(screen.queryByTestId(`${ID}-bar-2026-09-21`)).toBeNull();
  // The newest week is the focused one until another is selected.
  expect(barFill(`${ID}-bar-2026-10-05`)).toBe(roles.ink);
  expect(hidden(`${ID}-tick-0`)).toHaveTextContent('0');
  expect(hidden(`${ID}-tick-400`)).toHaveTextContent('400');
  expect(screen.queryByTestId(`${ID}-unit`, { includeHiddenElements: true })).toBeNull();
});

it('draws 1RM as columns too, its whole ticks without a decimal', () => {
  const { rerender } = renderWithTheme(chart({ metric: 'estimatedRM1', days: [day('2026-10-05', { estimatedRM1: 9 })] }));
  expect(hidden(`${ID}-tick-2.5`)).toHaveTextContent('2.5');
  expect(hidden(`${ID}-tick-5`)).toHaveTextContent('5');
  rerender(chart({ metric: 'estimatedRM1' }));
  expect(screen.getAllByTestId(/history-timeline-bar-/)).toHaveLength(3);
  expect(hidden(`${ID}-tick-100`)).toHaveTextContent('100');
});

it('fills the selected column in ink, so a full column still shows it', () => {
  renderWithTheme(chart({ selectedWeekKey: '2026-09-14' }));
  expect(barFill(`${ID}-bar-2026-09-14`)).toBe(roles.ink);
  expect(barFill(`${ID}-bar-2026-09-28`)).toBe(roles.viz4);
});

it('marks the week it reads out, selected or not, so the two never disagree', () => {
  const { rerender } = renderWithTheme(chart());
  expect(hidden(`${ID}-readout-week`)).toHaveTextContent('5–11 Oct 2026');
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('100 volume');
  // The readout names the week alone: the current week takes no note.
  expect(screen.queryByText('Current week', { includeHiddenElements: true })).toBeNull();
  // The newest of the five 60pt columns, with nothing selected.
  expect(screen.getByTestId(`${ID}-selected`)).toHaveProp('x', 240);

  rerender(chart({ selectedWeekKey: '2026-09-14' }));
  expect(hidden(`${ID}-readout-week`)).toHaveTextContent('14–20 Sep 2026');
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('400 volume');
  expect(screen.getByTestId(`${ID}-selected`)).toHaveProp('x', 60);
});

it('draws the focused week as the readout\'s heading, in the display face', () => {
  renderWithTheme(chart());
  expect(hidden(`${ID}-readout-week`)).toHaveStyle({ fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.lg });
});

it('steps to the previous and next week with the readout\'s arrows, stopping at the window\'s ends', () => {
  const onSelectWeek = jest.fn();
  // Opens on the newest week: there is no next one.
  const { rerender } = renderWithTheme(chart({ onSelectWeek }));
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
  const { rerender } = renderWithTheme(chart({ selectedWeekKey: '2026-09-21' }));
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('0 volume');
  expect(screen.getByTestId(`${ID}-plot`)).toHaveProp('accessibilityValue', { text: 'Week of 21-09-2026 – 27-09-2026, Volume 0' });

  rerender(chart({ metric: 'estimatedRM1', selectedWeekKey: '2026-09-21' }));
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('No sets');
  expect(screen.getByTestId(`${ID}-plot`)).toHaveProp('accessibilityValue', { text: 'Week of 21-09-2026 – 27-09-2026, 1RM No sets' });
});

it('speaks a unit that differs from the metric', () => {
  renderWithTheme(chart({ metric: 'estimatedRM1' }));
  expect(screen.getByTestId(`${ID}-plot`)).toHaveProp('accessibilityValue', { text: 'Week of 05-10-2026 – 11-10-2026, 1RM 80.0 kg, Current week' });
});

it('reads an unavailable week as unavailable', () => {
  renderWithTheme(chart({ days: [day('2026-10-05', { totalVolume: null })] }));
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('Unavailable');
});

it('leaves View sessions to the page: the chart holds no button for it', () => {
  renderWithTheme(chart());
  expect(screen.queryByText('View sessions', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByTestId(`${ID}-view-sessions`, { includeHiddenElements: true })).toBeNull();
});

it('names one set in the singular', () => {
  renderWithTheme(chart({ metric: 'workingSetCount', days: [day('2026-10-05', { workingSetCount: 1 })] }));
  expect(hidden(`${ID}-readout-value`)).toHaveTextContent('1 set');
  expect(hidden(`${ID}-readout-value`)).not.toHaveTextContent('1 sets');
});

it('keeps the announced week on a VoiceOver double tap, which presses with no location', () => {
  const onSelectWeek = jest.fn();
  renderWithTheme(chart({ onSelectWeek, selectedWeekKey: '2026-09-14' }));
  // The announced week is already the focused one, so there is nothing to toggle.
  expect(screen.getByTestId(`${ID}-plot`).props.accessibilityActions)
    .toEqual([{ name: 'increment' }, { name: 'decrement' }]);
  fireEvent.press(screen.getByTestId(`${ID}-plot`), { nativeEvent: {} });
  expect(onSelectWeek).not.toHaveBeenCalled();
});

it('shows the week detail below the chart', () => {
  renderWithTheme(chart({ children: <Text testID="week-detail">sets</Text> }));
  expect(screen.getByTestId('week-detail')).toBeTruthy();
});

it('focuses the tapped week, and a second tap on it changes nothing', () => {
  const onSelectWeek = jest.fn();
  // Five rows over the 300pt fallback plot: 60pt columns.
  const { rerender } = renderWithTheme(chart({ onSelectWeek }));
  fireEvent.press(screen.getByTestId(`${ID}-plot`), { nativeEvent: { locationX: 190 } });
  expect(onSelectWeek).toHaveBeenLastCalledWith('2026-09-28');

  rerender(chart({ onSelectWeek, selectedWeekKey: '2026-09-28' }));
  fireEvent.press(screen.getByTestId(`${ID}-plot`), { nativeEvent: { locationX: 190 } });
  expect(onSelectWeek).toHaveBeenLastCalledWith('2026-09-28');
  expect(screen.getByTestId(`${ID}-selected`)).toHaveProp('x', 180);
});

it('steps through weeks as an adjustable element', () => {
  const onSelectWeek = jest.fn();
  const { rerender } = renderWithTheme(chart({ onSelectWeek }));
  const plot = screen.getByTestId(`${ID}-plot`);
  expect(plot).toHaveProp('accessibilityRole', 'adjustable');
  expect(plot).toHaveProp('accessibilityValue', { text: 'Week of 05-10-2026 – 11-10-2026, Volume 100, Current week' });
  fireEvent(plot, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  expect(onSelectWeek).not.toHaveBeenCalled(); // already the newest week
  fireEvent(plot, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
  expect(onSelectWeek).toHaveBeenLastCalledWith('2026-09-28');

  rerender(chart({ onSelectWeek, selectedWeekKey: '2026-09-14' }));
  fireEvent(screen.getByTestId(`${ID}-plot`), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  expect(onSelectWeek).toHaveBeenLastCalledWith('2026-09-21');
});

it('keeps every week a tappable column, scrolling sideways once the window outgrows the plot', () => {
  const { rerender } = renderWithTheme(chart());
  expect(screen.getByTestId(`${ID}-scroll`)).toHaveProp('scrollEnabled', false);
  rerender(chart({ weeks: 104 }));
  expect(screen.getByTestId(`${ID}-scroll`)).toHaveProp('scrollEnabled', true);
  // 105 weeks at the 32pt floor rather than 2.9pt slivers: about a dozen of
  // them sit on the 300pt plot, and the rest are a swipe away.
  expect(screen.getByTestId(`${ID}-plot`)).toHaveStyle({ width: 105 * MIN_TIMELINE_COLUMN_WIDTH });
});

it('labels months at the first week starting in each, which wider columns all have room for', () => {
  renderWithTheme(chart({ weeks: 16 }));
  expect(screen.getByTestId(`${ID}-month-3`)).toHaveTextContent('Jul');
  expect(screen.getByText('2026')).toBeTruthy();
  expect(screen.getByTestId(`${ID}-month-7`)).toHaveTextContent('Aug');
  expect(screen.getByTestId(`${ID}-month-12`)).toHaveTextContent('Sep');
  expect(screen.getByTestId(`${ID}-month-16`)).toHaveTextContent('Oct');
});

it('tracks fractional weeks around the pinch anchor and settles within the loaded history', () => {
  expect(resizeTimelineWindow(52, 26, 0.25, 9.4, false)).toEqual({ start: 23.65, span: 9.4 });
  expect(resizeTimelineWindow(52, 26, 0.25, 9.4, true)).toEqual({ start: 24, span: 9 });
  expect(resizeTimelineWindow(105, 60, 0.5, 90, false)).toEqual({ start: 15, span: 90 });
  expect(resizeTimelineWindow(105, 60, 0.5, 130, true)).toEqual({ start: 0, span: 105 });
  expect(resizeTimelineWindow(52, 52, 0.05, 0.2, true)).toEqual({ start: 51, span: 1 });
});

it('steps one whole week around a visible selection or the middle of the browsed range', () => {
  expect(stepTimelineZoom({ start: 6.5, span: 8 }, 30, 14, -1)).toEqual({ start: 7, span: 7 });
  expect(stepTimelineZoom({ start: 6.5, span: 8 }, 30, 0, 1)).toEqual({ start: 6, span: 9 });
});

it('offers accessible landscape zoom buttons without changing selection, values or opening details', () => {
  const onInspect = jest.fn();
  const onSelectWeek = jest.fn();
  const { rerender } = renderWithTheme(chart({ onSelectWeek, display: { expanded: true, onInspect } }));
  const zoomIn = () => screen.getByRole('button', { name: 'Zoom in' });
  const zoomOut = () => screen.getByRole('button', { name: 'Zoom out' });
  const plot = () => screen.getByTestId(`${ID}-plot`);
  const focus = plot().props.accessibilityValue;
  expect(zoomOut()).toBeDisabled();
  for (let span = 4; span >= 1; span -= 1) {
    fireEvent.press(zoomIn());
    expect(plot()).toHaveProp('accessibilityHint', span === 1 ? '1 week visible' : `${span} weeks visible`);
  }
  expect(zoomIn()).toBeDisabled();
  expect(plot()).toHaveProp('accessibilityValue', focus);
  expect(hidden(`${ID}-tick-400`)).toHaveTextContent('400');
  expect(hidden(`${ID}-month-4`)).toHaveTextContent('Oct');
  expect(onSelectWeek).not.toHaveBeenCalled();
  expect(onInspect).not.toHaveBeenCalled();

  fireEvent.press(zoomOut());
  expect(plot()).toHaveProp('accessibilityHint', '2 weeks visible');
  fireEvent.press(plot(), { nativeEvent: { locationX: 40 } });
  expect(onSelectWeek).toHaveBeenLastCalledWith('2026-09-28');
  expect(onInspect).toHaveBeenCalledTimes(1);

  rerender(chart({ display: { expanded: false } }));
  expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
  rerender(chart({ display: { expanded: true } }));
  expect(zoomOut()).toBeDisabled();
  expect(plot()).toHaveProp('accessibilityHint', '5 weeks visible');
});

it('opens at one year and steps out to every loaded week, including the partial week', () => {
  const onSelectWeek = jest.fn();
  const onInspect = jest.fn();
  renderWithTheme(chart({ weeks: 78, onSelectWeek, display: { expanded: true, onInspect } }));
  const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
  const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
  const plot = screen.getByTestId(`${ID}-plot`);
  const focus = plot.props.accessibilityValue;
  expect(plot).toHaveProp('accessibilityHint', '52 weeks visible');

  for (const span of [65, 78, 79]) {
    expect(zoomOut).toBeEnabled();
    fireEvent.press(zoomOut);
    expect(plot).toHaveProp('accessibilityHint', `${span} weeks visible`);
  }
  expect(zoomOut).toBeDisabled();
  expect(plot).toHaveProp('accessibilityValue', focus);
  expect(onSelectWeek).not.toHaveBeenCalled();

  fireEvent.press(plot, { nativeEvent: { locationX: 1 } });
  expect(onSelectWeek).toHaveBeenCalledWith('2025-04-07');
  expect(onInspect).toHaveBeenCalledTimes(1);

  for (const span of [66, 53, 52, 51]) {
    fireEvent.press(zoomIn);
    expect(plot).toHaveProp('accessibilityHint', `${span} weeks visible`);
  }
});

it('keeps a moved details window inside the chart when its content grows', () => {
  const area = { width: 280, height: 240, initialX: 120, maxX: 120 };
  const window = () => (
    <TimelineDetailsWindow area={area} heading="24-11-2026" gym="Canal Street Gym" onClose={jest.fn()} testID="week-details">
      <Text>Session sets</Text>
    </TimelineDetailsWindow>
  );
  const { rerender } = renderWithTheme(window());
  const control = screen.getByTestId('week-details-move');
  expect(control).toHaveAccessibleName('24-11-2026, Canal Street Gym, Move week details');
  const move = (actionName: string) => fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName } });
  const measure = (height: number) => fireEvent(screen.getByTestId('week-details-position'), 'layout', { nativeEvent: { layout: { height } } });
  const expectPosition = (x: number, y: number) => {
    rerender(window());
    expect(screen.getByTestId('week-details-position')).toHaveStyle({ transform: [{ translateX: x }, { translateY: y }] });
  };

  measure(160);
  move('moveRight');
  expectPosition(120, 0);
  move('moveLeft');
  move('moveDown');
  move('moveDown');
  expectPosition(76, 80);
  measure(220);
  expectPosition(76, 20);
  move('moveUp');
  expectPosition(76, 0);
});
