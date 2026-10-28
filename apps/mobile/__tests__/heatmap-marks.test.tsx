import { render, screen } from '@testing-library/react-native';
import { FlatList, StyleSheet } from 'react-native';
import { HeatmapLegend } from '@/components/heatmaps/HeatmapLegend';

import { DailyHeatmap, HEAT_RAMP, WeeklyHeatmap, buildHeatmapData } from '@/components/heatmaps';
import { uiRoles } from '@/components/ui';
import type { DailyEffortMetrics } from '@/src/data';

// Daily tiles are read-only. Weekly selection retains its caret and accessible state
// without adding borders or a banner.

const TODAY = '2026-05-13'; // a Wednesday
const PREFIX = 'history';

const day = (dateKey: string, totalVolume: number): DailyEffortMetrics => ({
  dateKey,
  totalVolume,
  workingSetCount: 2,
  estimatedRM1: 95,
  highestWeight: 80,
});

const data = buildHeatmapData([day('2026-05-11', 1200), day(TODAY, 800), day('2026-05-04', 400)], 'totalVolume', {
  todayDateKey: TODAY,
});

const style = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style);
const border = (testID: string) => {
  const { borderWidth, borderColor } = style(testID);
  return { borderWidth, borderColor };
};

const renderDaily = () =>
  render(
    <DailyHeatmap
      data={data}
      formatValue={(value) => String(value)}
      metricLabel="Volume"
      testIDPrefix={PREFIX}
    />
  );

describe('DailyHeatmap marks', () => {
  it('puts the 0–100% maximum legend in the list header, before the calendars', () => {
    renderDaily();
    const list = screen.UNSAFE_getByType(FlatList);
    expect(list.props.ListFooterComponent).toBeUndefined();
    expect(screen.getByText('% of max')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
    expect(list.props.ListHeaderComponent.props.children.at(-1).type).toBe(HeatmapLegend);
  });
  it('announces today without selecting or outlining it', () => {
    renderDaily();

    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-${TODAY}`).props.accessibilityState).toBeUndefined();
    expect(border(`${PREFIX}-heatmap-cell-${TODAY}`)).toEqual({ borderWidth: StyleSheet.hairlineWidth, borderColor: uiRoles.rule });
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-${TODAY}`).props.accessibilityLabel).toContain('Today');
    expect(screen.queryByTestId(`${PREFIX}-heatmap-day-detail`)).toBeNull();
  });

  it('shows values as accessible text without a press action', () => {
    renderDaily();

    const tile = screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-11`);
    expect(tile).toHaveProp('accessibilityRole', 'text');
    expect(tile.props.onPress).toBeUndefined();
    expect(tile.props.accessibilityState).toBeUndefined();
    expect(border(`${PREFIX}-heatmap-cell-2026-05-11`)).toEqual({ borderWidth: StyleSheet.hairlineWidth, borderColor: uiRoles.rule });
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-11-value`)).toHaveTextContent('1200');
  });

  it('draws a rest day on viz0 with a rule hairline and announces rest accessibly', () => {
    renderDaily();

    expect(style(`${PREFIX}-heatmap-cell-2026-05-12`)).toMatchObject({
      backgroundColor: uiRoles.viz0,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: uiRoles.rule,
    });

    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-12-value`)).toHaveTextContent('', { exact: true });
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-12`).props.accessibilityLabel).toContain('Rest');
  });

  it('colours cells from the viz ramp', () => {
    expect(HEAT_RAMP).toEqual([uiRoles.viz0, uiRoles.viz1, uiRoles.viz2, uiRoles.viz3, uiRoles.viz4]);
    renderDaily();

    // The heaviest day in the window is the top step.
    expect(style(`${PREFIX}-heatmap-cell-2026-05-11`).backgroundColor).toBe(uiRoles.viz4);
  });
});

describe('WeeklyHeatmap marks', () => {
  it('puts the maximum legend before the axis and rows', () => {
    render(<WeeklyHeatmap data={data} metric="totalVolume" testIDPrefix={PREFIX} formatValue={String} />);
    expect(screen.UNSAFE_getByType(FlatList).props.ListFooterComponent).toBeUndefined();
    expect(screen.UNSAFE_getByType(FlatList).props.ListHeaderComponent.props.children[1].type).toBe(HeatmapLegend);
  });
  it('keeps current and past bars borderless, with no selected state', () => {
    render(<WeeklyHeatmap data={data} metric="totalVolume" onOpenWeek={jest.fn()} testIDPrefix={PREFIX} formatValue={String} />);

    expect(border(`${PREFIX}-heatmap-bar-2026-05-04`)).toEqual({ borderWidth: undefined, borderColor: undefined });
    expect(border(`${PREFIX}-heatmap-bar-2026-05-11`)).toEqual({ borderWidth: undefined, borderColor: undefined });
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-11`).props.accessibilityState?.selected).toBeFalsy();
  });
});

it('labels target grading as a 0–100% target share', () => {
  render(<HeatmapLegend target />);
  expect(screen.getByText('% of target')).toBeTruthy();
  expect(screen.getByText('0%')).toBeTruthy();
  expect(screen.getByText('100%')).toBeTruthy();
});


describe('Bodyweight heatmap coverage', () => {
  it('distinguishes zero-load training, unknown load and rest in daily tiles', () => {
    const coverage = buildHeatmapData([
      day('2026-05-11', 0),
      { ...day('2026-05-12', 0), totalVolume: null },
    ], 'totalVolume', { todayDateKey: TODAY });
    render(<DailyHeatmap data={coverage} formatValue={String} metricLabel="Volume" testIDPrefix={PREFIX} />);
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-11`)).toHaveProp('accessibilityLabel', '11-05-2026, Volume 0');
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-11-value`)).toHaveTextContent('0');
    expect(style(`${PREFIX}-heatmap-cell-2026-05-12`).borderStyle).toBe('dashed');
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-12-value`)).toHaveTextContent('', { exact: true });
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-12`)).toHaveProp('accessibilityLabel', '12-05-2026, Volume unavailable');
    expect(screen.queryByText(/Rest|\?/)).toBeNull();
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-${TODAY}`).props.accessibilityLabel).toContain('Rest');
  });

  it.each([
    [[0, 0, 0, 0, 100, 200], 0],
  ])('places zero references at the origin and positive references proportionally on the zero-based scale', (values, median) => {
    const dates = ['2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27', '2026-05-04', '2026-05-11'];
    const coverage = buildHeatmapData(dates.map((date, index) => day(date, values[index])), 'totalVolume', { todayDateKey: TODAY });
    render(<WeeklyHeatmap data={coverage} metric="totalVolume" testIDPrefix={PREFIX} formatValue={(value) => `~${value}`} />);
    expect(screen.getByTestId(`${PREFIX}-heatmap-median`)).toHaveProp('accessibilityLabel', `53-week median ~${median}`);
    expect(style(`${PREFIX}-heatmap-median`).left).toBe('0%');
    expect(style(`${PREFIX}-heatmap-p25`).left).toBe('0%');
    expect(style(`${PREFIX}-heatmap-p75`).left).toBe('37.5%');
  });
});
