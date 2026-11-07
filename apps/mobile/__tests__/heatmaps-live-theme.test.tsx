import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Rect } from 'react-native-svg';

import { DailyHeatmap, TimelineHeatmap, WeeklyHeatmap, buildHeatmapData, heatRamp } from '@/components/heatmaps';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';
import type { DailyEffortMetrics } from '@/src/data';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// The heatmaps draw in the roles of the saved appearance, so a save repaints
// them where they stand (`components/ui/theme-context.tsx`).

const TODAY = '2026-05-13';
const SLATE_DARK = { theme: 'slate', mode: 'dark', custom: null } as const;

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
const launch = rolesFor(DEFAULT_APPEARANCE);
const slate = rolesFor(SLATE_DARK);

it('repaints the daily tiles, the legend and the month rules when the theme is saved', async () => {
  renderWithTheme(<DailyHeatmap data={data} formatValue={String} metricLabel="Volume" testIDPrefix="live" />);
  const tile = 'live-heatmap-cell-2026-05-11';
  const level = heatRamp(launch).indexOf(style(tile).backgroundColor);
  expect(level).toBeGreaterThan(0);
  expect(style(`${tile}-value`).color).toBe(launch.ink);
  expect(style('live-heatmap-week-separator-2026-05')).toMatchObject({ backgroundColor: launch.rule });

  await switchTheme(SLATE_DARK);

  expect(style(tile)).toMatchObject({ backgroundColor: heatRamp(slate)[level], borderColor: slate.rule });
  expect(style(`${tile}-value`).color).toBe(slate.ink);
  expect(style('live-heatmap-week-separator-2026-05')).toMatchObject({ backgroundColor: slate.rule });
  expect(slate.rule).not.toBe(launch.rule);
});

it('repaints the weekly bars and rules when the theme is saved', async () => {
  renderWithTheme(<WeeklyHeatmap data={data} metric="totalVolume" formatValue={String} metricLabel="Volume" testIDPrefix="live" />);
  const week = data.weekly.find((cell) => cell.value > 0)!;
  const bar = `live-heatmap-bar-${week.weekStartDateKey}`;
  expect(style(bar).backgroundColor).toBe(heatRamp(launch)[week.level]);
  expect(style(`live-heatmap-track-${week.weekStartDateKey}`).backgroundColor).toBe(launch.ruleSoft);

  await switchTheme(SLATE_DARK);

  expect(style(bar).backgroundColor).toBe(heatRamp(slate)[week.level]);
  expect(style(`live-heatmap-track-${week.weekStartDateKey}`).backgroundColor).toBe(slate.ruleSoft);
});

it('repaints the timeline selection band when the theme is saved', async () => {
  const { UNSAFE_getByType } = renderWithTheme(
    <TimelineHeatmap data={data} metric="totalVolume" selectedWeekKey={null} onSelectWeek={jest.fn()} formatValue={String}
      metricLabel="Volume" unitLabel={() => ''} testIDPrefix="live" />,
  );
  expect(UNSAFE_getByType(Rect).props.fill).toBe(launch.ruleSoft);

  await switchTheme(SLATE_DARK);

  expect(UNSAFE_getByType(Rect).props.fill).toBe(slate.ruleSoft);
});
