import {
  barPath,
  MONTH_LABEL_WIDTH,
  buildTimelineSeries,
  niceStep,
  timelineGeometry,
  timelineTicks,
  timelineWeekIndexAt,
  weekRangeLabel,
} from '@/components/heatmaps/timeline';
import { buildHeatmapData } from '@/components/heatmaps';
import type { CalendarHeatmapMetric, DailyEffortMetrics } from '@/src/data';

const TODAY = '2026-10-07'; // a Wednesday; its week starts 2026-10-05
const day = (dateKey: string, over: Partial<DailyEffortMetrics> = {}): DailyEffortMetrics => ({
  dateKey, totalVolume: 100, workingSetCount: 2, estimatedRM1: 50, highestWeight: 40, ...over,
});
const series = (days: DailyEffortMetrics[], metric: CalendarHeatmapMetric, weeks = 4) =>
  buildTimelineSeries(buildHeatmapData(days, metric, { todayDateKey: TODAY, weeks }).weekly, metric);
const values = (built: ReturnType<typeof series>) => built.weeks.map(week => week.value);

describe('buildTimelineSeries', () => {
  // Four weeks: 14 Sep, 21 Sep (rest), 28 Sep, 5 Oct (current).
  const days = [
    day('2026-09-14', { totalVolume: 100, workingSetCount: 3, estimatedRM1: 60, highestWeight: 50 }),
    day('2026-09-16', { totalVolume: 250, workingSetCount: 4, estimatedRM1: 70, highestWeight: 45 }),
    day('2026-09-29', { totalVolume: 40, workingSetCount: 1, estimatedRM1: 55, highestWeight: 52.5 }),
    day('2026-10-06', { totalVolume: 10, workingSetCount: 1, estimatedRM1: 30, highestWeight: 30 }),
  ];

  it('buckets days into Monday weeks across the window, oldest first', () => {
    const built = series(days, 'totalVolume');
    expect(built.weeks.map(week => week.weekStartDateKey)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']);
    expect(built.weeks.map(week => week.isCurrentWeek)).toEqual([false, false, false, true]);
  });

  it.each([
    ['totalVolume', [350, 0, 40, 10]],
    ['workingSetCount', [7, 0, 1, 1]],
    ['estimatedRM1', [70, 0, 55, 30]],
    ['highestWeight', [50, 0, 52.5, 30]],
  ] as const)('%s sums or takes the weekly best; a rest week is zero', (metric, expected) => {
    const built = series(days, metric);
    expect(values(built)).toEqual(expected);
    expect(built.weeks.map(week => week.state)).toEqual(['training', 'rest', 'training', 'training']);
  });

  it('leaves an unavailable week as a gap for every metric', () => {
    const unknown = [day('2026-09-28', { totalVolume: null, estimatedRM1: null, highestWeight: null }), day('2026-10-05')];
    expect(values(series(unknown, 'totalVolume'))).toEqual([0, 0, null, 100]);
    expect(values(series(unknown, 'estimatedRM1'))).toEqual([0, 0, null, 50]);
    expect(series(unknown, 'estimatedRM1').weeks[2].state).toBe('unavailable');
  });

  it('keeps a known zero as a plotted value', () => {
    expect(values(series([day('2026-09-28', { totalVolume: 0 })], 'totalVolume'))).toEqual([0, 0, 0, 0]);
    expect(series([day('2026-09-28', { totalVolume: 0 })], 'totalVolume').weeks[2].state).toBe('training');
  });

  it('labels each month at the first week starting in it, with the year on January and the first label', () => {
    const built = series([], 'totalVolume', 16); // 22 Jun … 5 Oct 2026
    expect(built.weeks[0].weekStartDateKey).toBe('2026-06-22');
    expect(built.months).toEqual([
      { index: 2, label: 'Jul', year: 2026 }, // 6 Jul
      { index: 6, label: 'Aug' }, // 3 Aug
      { index: 11, label: 'Sep' }, // 7 Sep
      { index: 15, label: 'Oct' }, // 5 Oct
    ]);
    // 29 Dec 2025 starts in December, so it belongs to December; 5 Jan carries January.
    const turn = buildTimelineSeries(buildHeatmapData([], 'totalVolume', { todayDateKey: '2026-01-14', weeks: 4 }).weekly, 'totalVolume');
    expect(turn.weeks.map(week => week.weekStartDateKey)).toEqual(['2025-12-22', '2025-12-29', '2026-01-05', '2026-01-12']);
    expect(turn.months).toEqual([{ index: 2, label: 'Jan', year: 2026 }]);
  });

  it('draws only the zero baseline for an empty window', () => {
    expect(series([], 'totalVolume').ticks).toEqual([0]);
    expect(series([], 'estimatedRM1').ticks).toEqual([0]);
  });
});

describe('timelineTicks', () => {
  it('starts at zero and ends on the first nice step at or above the largest value', () => {
    expect(timelineTicks([350, 0, 40], false)).toEqual([0, 100, 200, 300, 400]);
    expect(timelineTicks([131.2, 92.5], false)).toEqual([0, 50, 100, 150]);
    expect(timelineTicks([0.4], false)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(timelineTicks([0, 0], false)).toEqual([0]);
    expect(timelineTicks([], false)).toEqual([0]);
  });

  it('uses whole steps for set counts', () => {
    expect(timelineTicks([7, 1], true)).toEqual([0, 2, 4, 6, 8]);
    expect(timelineTicks([1], true)).toEqual([0, 1]);
    expect(niceStep(3, true)).toBe(1);
  });
});

describe('timelineGeometry', () => {
  const built = series([
    day('2026-09-14', { totalVolume: 400, estimatedRM1: 100 }),
    day('2026-09-28', { totalVolume: 200, estimatedRM1: 90 }),
    day('2026-10-05', { totalVolume: 100, estimatedRM1: 80 }),
  ], 'totalVolume');

  it('fits the window to the width with zero-based columns', () => {
    const geometry = timelineGeometry(built, 400, 100);
    expect(geometry.columnWidth).toBe(100);
    expect(geometry.width).toBe(400);
    expect(geometry.bars).toEqual([
      { weekStartDateKey: '2026-09-14', index: 0, x: 38, y: 0, width: 24, height: 100 },
      { weekStartDateKey: '2026-09-28', index: 2, x: 238, y: 50, width: 24, height: 50 },
      { weekStartDateKey: '2026-10-05', index: 3, x: 338, y: 75, width: 24, height: 25 },
    ]);
    expect(geometry.ticks.map(tick => tick.y)).toEqual([100, 75, 50, 25, 0]);
  });

  it('keeps a minimum column width and grows wider than the plot to scroll', () => {
    const long = series([], 'totalVolume', 104);
    const geometry = timelineGeometry(long, 300, 100);
    expect(geometry.columnWidth).toBe(6);
    expect(geometry.width).toBe(624);
    expect(timelineWeekIndexAt(623, geometry.columnWidth, 104)).toBe(103);
    expect(timelineWeekIndexAt(-4, geometry.columnWidth, 104)).toBe(0);
    expect(timelineWeekIndexAt(13, geometry.columnWidth, 104)).toBe(2);
  });

  it('draws a best-of metric as zero-based columns too, leaving an unavailable week empty', () => {
    const best = series([
      day('2026-09-14', { estimatedRM1: 100 }),
      day('2026-09-28', { estimatedRM1: null }),
      day('2026-10-05', { estimatedRM1: 80 }),
    ], 'estimatedRM1');
    expect(best.ticks).toEqual([0, 25, 50, 75, 100]);
    expect(timelineGeometry(best, 400, 100).bars.map(bar => [bar.weekStartDateKey, bar.height]))
      .toEqual([['2026-09-14', 100], ['2026-10-05', 80]]);
  });

  it('keeps month labels apart, preferring the ones carrying a year', () => {
    // 52 weeks over 260pt: 5pt columns become 6pt, so a month is ~26pt wide.
    const year = buildTimelineSeries(buildHeatmapData([], 'totalVolume', { todayDateKey: '2026-03-04', weeks: 52 }).weekly, 'totalVolume');
    const geometry = timelineGeometry(year, 260, 100);
    const kept = geometry.months.map(month => `${month.label}${month.year ?? ''}`);
    expect(kept).toContain('Jan2026');
    expect(kept[0]).toMatch(/2025$/);
    geometry.months.slice(1).forEach((month, index) =>
      expect(month.x - geometry.months[index].x).toBeGreaterThanOrEqual(MONTH_LABEL_WIDTH));
    expect(Math.max(...geometry.months.map(month => month.x)) + MONTH_LABEL_WIDTH).toBeLessThanOrEqual(geometry.width);
    expect(geometry.months.length).toBeLessThan(year.months.length);
  });

  it('draws a column with a rounded top and a square baseline', () => {
    expect(barPath({ weekStartDateKey: 'w', index: 0, x: 2, y: 10, width: 8, height: 30 }))
      .toBe('M 2,40V14Q2,10 6,10H6Q10,10 10,14V40Z');
  });
});

it('names a week by its Monday and Sunday', () => {
  expect(weekRangeLabel(new Date(Date.UTC(2026, 8, 28)))).toBe('28 Sep – 4 Oct');
  expect(weekRangeLabel(new Date(Date.UTC(2026, 9, 5)))).toBe('5 – 11 Oct');
});
