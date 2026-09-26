import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DailyHeatmap, HEAT_RAMP, WeeklyHeatmap, buildHeatmapData } from '@/components/heatmaps';
import { uiRoles } from '@/components/ui';
import type { DailyEffortMetrics } from '@/src/data';

// Today and the selected day (or week) are marked differently: today a 1px
// `ink` ring, the selected cell a 2px `ink` border plus the selected state
// (DLM-T09-D3). They used to be drawn identically.

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
  it('selects today by default and draws it with the selected border', () => {
    renderDaily();

    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-${TODAY}`)).toHaveProp('accessibilityState', { selected: true });
    expect(border(`${PREFIX}-heatmap-cell-${TODAY}`)).toEqual({ borderWidth: 2, borderColor: uiRoles.ink });
    expect(screen.getByTestId(`${PREFIX}-heatmap-day-detail`)).toHaveTextContent(/Today/);
  });

  it('gives a selected day a different border from today', () => {
    renderDaily();

    fireEvent.press(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-11`));

    const selected = border(`${PREFIX}-heatmap-cell-2026-05-11`);
    const today = border(`${PREFIX}-heatmap-cell-${TODAY}`);
    expect(selected).toEqual({ borderWidth: 2, borderColor: uiRoles.ink });
    expect(today).toEqual({ borderWidth: 1, borderColor: uiRoles.ink });
    expect(selected).not.toEqual(today);
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-11`)).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId(`${PREFIX}-heatmap-cell-${TODAY}`)).toHaveProp('accessibilityState', { selected: false });
    expect(screen.getByTestId(`${PREFIX}-heatmap-day-detail-value`)).toHaveTextContent('Volume: 1200');
  });

  it('draws a rest day on viz0 with a rule hairline and says so in the detail', () => {
    renderDaily();

    expect(style(`${PREFIX}-heatmap-cell-2026-05-12`)).toMatchObject({
      backgroundColor: uiRoles.viz0,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: uiRoles.rule,
    });

    fireEvent.press(screen.getByTestId(`${PREFIX}-heatmap-cell-2026-05-12`));
    expect(border(`${PREFIX}-heatmap-cell-2026-05-12`)).toEqual({ borderWidth: 2, borderColor: uiRoles.ink });
    expect(screen.getByTestId(`${PREFIX}-heatmap-day-detail-value`)).toHaveTextContent('Rest day');
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
      <WeeklyHeatmap data={data} onSelectWeek={jest.fn()} selectedWeekKey={selectedWeekKey} testIDPrefix={PREFIX} />
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
