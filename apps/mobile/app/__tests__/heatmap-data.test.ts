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
  it('maps the value/max ratio onto buckets 0..4', () => {
    expect(getCalendarHeatmapBucket(0, 100)).toBe(0);
    expect(getCalendarHeatmapBucket(10, 100)).toBe(1);
    expect(getCalendarHeatmapBucket(50, 100)).toBe(2);
    expect(getCalendarHeatmapBucket(75, 100)).toBe(3);
    expect(getCalendarHeatmapBucket(100, 100)).toBe(4);
  });

  it('returns 0 (rest) when there is no positive max', () => {
    expect(getCalendarHeatmapBucket(0, 0)).toBe(0);
    expect(getCalendarHeatmapBucket(5, 0)).toBe(0);
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

  it('sums additive metrics across the week and buckets by daily max', () => {
    const data = buildHeatmapData(daily, 'totalVolume', { todayDateKey: TODAY });
    const wed = data.daily.find((d) => d.dateKey === '2026-06-03')!;
    const thu = data.daily.find((d) => d.dateKey === '2026-06-04')!;
    expect(wed.value).toBe(100);
    expect(thu.value).toBe(300);
    expect(thu.level).toBe(4); // 300/300
    expect(wed.level).toBe(2); // 100/300 ≈ 0.33

    const currentWeek = data.weekly.find((w) => w.weekStartDateKey === '2026-06-01')!;
    expect(currentWeek.value).toBe(400); // 100 + 300
    expect(currentWeek.sessions).toBe(2);
  });

  it('takes the max for best-of metrics (top weight)', () => {
    const data = buildHeatmapData(daily, 'highestWeight', { todayDateKey: TODAY });
    const currentWeek = data.weekly.find((w) => w.weekStartDateKey === '2026-06-01')!;
    expect(currentWeek.value).toBe(60); // max(40, 60)
  });

  it('renders an all-rest grid for empty input', () => {
    const data = buildHeatmapData([], 'totalVolume', { todayDateKey: TODAY });
    expect(data.daily.every((d) => d.level === 0 && d.value === 0)).toBe(true);
    expect(data.weekly.every((w) => w.level === 0 && w.value === 0 && w.sessions === 0)).toBe(true);
  });
});
