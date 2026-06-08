import {
  buildHeatmapData,
  getCalendarHeatmapBucket,
  getMetricValue,
  type HeatmapMetricSource,
} from '@/components/heatmaps';
import type { DailyEffortMetrics } from '@/src/data';

const source = (over: Partial<HeatmapMetricSource> = {}): HeatmapMetricSource => ({
  totalVolume: 0,
  nearFailureCount: 0,
  estimatedRM1: null,
  highestWeight: null,
  ...over,
});

describe('getCalendarHeatmapBucket', () => {
  it('normalizes across the observed [min, max] range onto buckets 1..4', () => {
    // observed range 10..110 (span 100): lowest logged value is light, highest is dark.
    expect(getCalendarHeatmapBucket(10, 10, 110)).toBe(1); // the min itself → light green
    expect(getCalendarHeatmapBucket(35, 10, 110)).toBe(1); // ratio 0.25
    expect(getCalendarHeatmapBucket(60, 10, 110)).toBe(2); // ratio 0.50
    expect(getCalendarHeatmapBucket(85, 10, 110)).toBe(3); // ratio 0.75
    expect(getCalendarHeatmapBucket(110, 10, 110)).toBe(4); // ratio 1.00
  });

  it('spreads a high-floor range (e.g. top weight 80..100) across the ramp', () => {
    // Previously every one of these landed in bucket 4 (all dark green).
    expect(getCalendarHeatmapBucket(80, 80, 100)).toBe(1); // lightest session
    expect(getCalendarHeatmapBucket(85, 80, 100)).toBe(1);
    expect(getCalendarHeatmapBucket(90, 80, 100)).toBe(2);
    expect(getCalendarHeatmapBucket(95, 80, 100)).toBe(3);
    expect(getCalendarHeatmapBucket(100, 80, 100)).toBe(4);
  });

  it('returns 0 (rest) when the value is non-positive or there is no activity', () => {
    expect(getCalendarHeatmapBucket(0, 0, 0)).toBe(0);
    expect(getCalendarHeatmapBucket(5, 0, 0)).toBe(0);
    expect(getCalendarHeatmapBucket(0, 80, 100)).toBe(0);
  });

  it('maps any activity to the top bucket when the range collapses (all equal)', () => {
    expect(getCalendarHeatmapBucket(90, 90, 90)).toBe(4);
  });
});

describe('getMetricValue', () => {
  it('treats non-positive volume / near-failure as no data', () => {
    expect(getMetricValue(source({ totalVolume: 0 }), 'totalVolume')).toBeNull();
    expect(getMetricValue(source({ totalVolume: 120 }), 'totalVolume')).toBe(120);
    expect(getMetricValue(source({ nearFailureCount: 0 }), 'nearFailureCount')).toBeNull();
    expect(getMetricValue(source({ nearFailureCount: 3 }), 'nearFailureCount')).toBe(3);
  });

  it('passes through best-of metrics, including null', () => {
    expect(getMetricValue(source({ estimatedRM1: null }), 'estimatedRM1')).toBeNull();
    expect(getMetricValue(source({ estimatedRM1: 90 }), 'estimatedRM1')).toBe(90);
    expect(getMetricValue(source({ highestWeight: 60 }), 'highestWeight')).toBe(60);
  });
});

describe('buildHeatmapData', () => {
  // 2026-06-05 is a Friday; Monday of its week is 2026-06-01.
  const TODAY = '2026-06-05';

  const daily: DailyEffortMetrics[] = [
    { dateKey: '2026-06-03', totalVolume: 100, nearFailureCount: 2, estimatedRM1: 50, highestWeight: 40 },
    { dateKey: '2026-06-04', totalVolume: 300, nearFailureCount: 1, estimatedRM1: 55, highestWeight: 60 },
  ];

  it('spans a Monday-aligned 52-week window ending today', () => {
    const data = buildHeatmapData([], 'totalVolume', { todayDateKey: TODAY });
    expect(data.weekly).toHaveLength(52);
    // 51 full weeks + Mon..Fri of the current week = 357 + 5 = 362 days.
    expect(data.daily).toHaveLength(362);
    expect(data.daily[data.daily.length - 1]).toMatchObject({ dateKey: TODAY, isToday: true });
    expect(data.weekly[data.weekly.length - 1]).toMatchObject({
      weekStartDateKey: '2026-06-01',
      isCurrentWeek: true,
    });
  });

  it('sums additive metrics across the week and buckets across the observed daily range', () => {
    const data = buildHeatmapData(daily, 'totalVolume', { todayDateKey: TODAY });
    const wed = data.daily.find((d) => d.dateKey === '2026-06-03')!;
    const thu = data.daily.find((d) => d.dateKey === '2026-06-04')!;
    expect(wed.value).toBe(100);
    expect(thu.value).toBe(300);
    // Observed daily range is [100, 300]: the min (wed) is light, the max (thu) is dark.
    expect(thu.level).toBe(4); // (300-100)/(300-100) = 1
    expect(wed.level).toBe(1); // (100-100)/(300-100) = 0

    const currentWeek = data.weekly.find((w) => w.weekStartDateKey === '2026-06-01')!;
    expect(currentWeek.value).toBe(400); // 100 + 300
    expect(currentWeek.sessions).toBe(2);
  });

  it('takes the max for best-of metrics (top weight)', () => {
    const data = buildHeatmapData(daily, 'highestWeight', { todayDateKey: TODAY });
    const currentWeek = data.weekly.find((w) => w.weekStartDateKey === '2026-06-01')!;
    expect(currentWeek.value).toBe(60); // max(40, 60)
  });

  it('with weeks: "all", spans from the earliest day in the data when it predates the default window', () => {
    // ~2 years before today — well outside the default 52-week window.
    const old: DailyEffortMetrics[] = [
      { dateKey: '2024-07-10', totalVolume: 100, nearFailureCount: 0, estimatedRM1: null, highestWeight: null },
      { dateKey: '2026-06-04', totalVolume: 300, nearFailureCount: 0, estimatedRM1: null, highestWeight: null },
    ];
    const data = buildHeatmapData(old, 'totalVolume', { todayDateKey: TODAY, weeks: 'all' });
    // Monday of 2024-07-10 (a Wednesday) is 2024-07-08.
    expect(data.daily[0].dateKey).toBe('2024-07-08');
    expect(data.daily[data.daily.length - 1]).toMatchObject({ dateKey: TODAY, isToday: true });
    expect(data.daily.length).toBeGreaterThan(362);
  });

  it('with weeks: "all", never shrinks below the default 52-week window for sparse recent data', () => {
    const data = buildHeatmapData(daily, 'totalVolume', { todayDateKey: TODAY, weeks: 'all' });
    expect(data.weekly).toHaveLength(52);
    expect(data.daily).toHaveLength(362);
  });

  it('renders an all-rest grid for empty input', () => {
    const data = buildHeatmapData([], 'totalVolume', { todayDateKey: TODAY });
    expect(data.daily.every((d) => d.level === 0 && d.value === 0)).toBe(true);
    expect(data.weekly.every((w) => w.level === 0 && w.value === 0 && w.sessions === 0)).toBe(true);
  });
});
