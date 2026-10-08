import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DailyHeatmap, HEAT_RAMP, WeeklyHeatmap, buildHeatmapData } from '@/components/heatmaps';
import { uiRoles } from '@/components/ui';
import type { DailyEffortMetrics } from '@/src/data';

// Daily tiles are read-only. Weekly bars retain current/selected marks because
// selecting a bar marks the row without adding a banner.

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
  const renderWeekly = (selectedWeekKey: string | null) =>
    render(
      <WeeklyHeatmap data={data} onSelectWeek={jest.fn()} selectedWeekKey={selectedWeekKey} testIDPrefix={PREFIX} formatValue={String} />
    );

  it('rings the current week and puts no marker up while nothing is selected', () => {
    renderWeekly(null);

    expect(border(`${PREFIX}-heatmap-bar-2026-05-11`)).toEqual({ borderWidth: 1, borderColor: uiRoles.ink });
    expect(screen.queryByTestId(`${PREFIX}-heatmap-selected-marker`)).toBeNull();
  });

  it('gives a selected week a different border from the current week, and the caret', () => {
    renderWeekly('2026-05-04');

    const selected = border(`${PREFIX}-heatmap-bar-2026-05-04`);
    const current = border(`${PREFIX}-heatmap-bar-2026-05-11`);
    expect(selected).toEqual({ borderWidth: 2, borderColor: uiRoles.ink });
    expect(current).toEqual({ borderWidth: 1, borderColor: uiRoles.ink });
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-04`)).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-11`)).toHaveProp('accessibilityState', { selected: false });
    expect(screen.getByTestId(`${PREFIX}-heatmap-selected-marker`)).toBeTruthy();
  });
});


describe('Bodyweight heatmap coverage', () => {
  it('distinguishes zero-load training, unknown load and rest in daily tiles', () => {
    const coverage = buildHeatmapData([
      day('2026-05-11', 0),
      { ...day('2026-05-12', 0), totalVolume: null },
    ], 'totalVolume', { todayDateKey: TODAY });
    render(<DailyHeatmap data={coverage} formatValue={String} metricLabel="Volume" testIDPrefix={PREFIX} />);
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-11`)).toHaveProp('accessibilityLabel', '2026-05-11, Volume 0');
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-11-value`)).toHaveTextContent('0');
    expect(style(`${PREFIX}-heatmap-cell-2026-05-12`).borderStyle).toBe('dashed');
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-12-value`)).toHaveTextContent('?');
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-${TODAY}`).props.accessibilityLabel).toContain('Rest');
  });

  it.each([
    [[0, 0, 0, 0, 100, 200], 0],
  ])('places the median and percentiles on the zero-based horizontal scale including known zero training', (values, median) => {
    const dates = ['2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27', '2026-05-04', '2026-05-11'];
    const coverage = buildHeatmapData(dates.map((date, index) => day(date, values[index])), 'totalVolume', { todayDateKey: TODAY });
    render(<WeeklyHeatmap data={coverage} onSelectWeek={jest.fn()} selectedWeekKey={null} testIDPrefix={PREFIX} formatValue={(value) => `~${value}`} />);
    expect(screen.getByTestId(`${PREFIX}-heatmap-median-label`)).toHaveProp('accessibilityLabel', `12-week median ~${median}`);
    expect(style(`${PREFIX}-heatmap-median`).left).toBe('0%');
    expect(style(`${PREFIX}-heatmap-p5`).left).toBe('0%');
    expect(style(`${PREFIX}-heatmap-p95`).left).toBe('87.5%');
  });
});
