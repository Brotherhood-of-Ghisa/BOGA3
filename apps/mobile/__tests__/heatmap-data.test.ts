import {
  buildHeatmapData,
  getCalendarHeatmapBucket,
  getMetricValue,
  type HeatmapMetricSource,
} from '@/components/heatmaps';
import type { DailyEffortMetrics } from '@/src/data';

const source = (over: Partial<HeatmapMetricSource> = {}): HeatmapMetricSource => ({
  totalVolume: 0,
  workingSetCount: 0,
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
  it('preserves known zero volume and working-set counts', () => {
    expect(getMetricValue(source({ totalVolume: 0 }), 'totalVolume')).toBe(0);
    expect(getMetricValue(source({ totalVolume: 120 }), 'totalVolume')).toBe(120);
    expect(getMetricValue(source({ workingSetCount: 0 }), 'workingSetCount')).toBe(0);
    expect(getMetricValue(source({ workingSetCount: 3 }), 'workingSetCount')).toBe(3);
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

  it.each(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])
  ('keeps four complete weeks, unique calendar dates and the ongoing row at %s', todayDateKey => {
    const data = buildHeatmapData([], 'totalVolume', { todayDateKey, weeks: 4 });
    const sunday = todayDateKey === '2026-10-11';
    expect(data.daily[0].dateKey).toBe(sunday ? '2026-09-14' : '2026-09-07');
    expect(data.weekly).toHaveLength(sunday ? 4 : 5);
    expect(data.weekly.at(-1)).toMatchObject({ weekStartDateKey: '2026-10-05', isCurrentWeek: true });
    expect(new Set(data.daily.map(day => day.dateKey)).size).toBe(data.daily.length);
    expect(data.daily.at(-1)?.dateKey).toBe(todayDateKey);
  });

  it.each([1, 4, 52, 104])('renders %i complete weeks plus the ongoing week through today', weeks => {
    const data = buildHeatmapData([], 'workingSetCount', { todayDateKey: TODAY, weeks });
    expect(data.weekly).toHaveLength(weeks + 1);
    expect(data.daily).toHaveLength(weeks * 7 + 5);
    expect(data.daily.at(-1)?.dateKey).toBe(TODAY);
    expect(data.daily.every(day => day.dateKey <= TODAY)).toBe(true);
  });

  it('carries the sessions behind each day, and none on a rest day', () => {
    const data = buildHeatmapData([{ ...source({ workingSetCount: 3 }), dateKey: '2026-06-03', sessionIds: ['a', 'b'] }],
      'workingSetCount', { todayDateKey: TODAY, weeks: 1 });
    expect(data.daily.slice(-5).map(day => [day.dateKey, day.sessionIds])).toEqual([
      ['2026-06-01', []], ['2026-06-02', []], ['2026-06-03', ['a', 'b']], ['2026-06-04', []], ['2026-06-05', []],
    ]);
  });

  it('grades two four-set days against eight weekly sets, and includes zero muscles in the group average', () => {
    const days = ['2026-06-03', '2026-06-04'].map(dateKey => ({ dateKey, totalVolume: 100,
      workingSetCount: 4, workingSetCountsByMuscle: { quads: 4 }, estimatedRM1: 50, highestWeight: 40 }));
    const data = buildHeatmapData(days, 'workingSetCount', { todayDateKey: TODAY, weeks: 4,
      muscleTargets: { muscleIds: ['quads'], weeklyTarget: 8 } });
    expect(data.daily.filter(day => day.hasTraining).map(day => [day.value, day.level, day.targetAttainment]))
      .toEqual([[4, 2, .5], [4, 2, .5]]);
    expect(data.weekly.at(-1)).toMatchObject({ value: 8, level: 4, targetAttainment: 1 });
    expect(data.targetGrading).toEqual({ averaged: false });
    const group = buildHeatmapData(days, 'workingSetCount', { todayDateKey: TODAY, weeks: 104,
      muscleTargets: { muscleIds: ['quads', 'calves'], weeklyTarget: 4 } });
    expect(group.weekly.at(-1)).toMatchObject({ value: 8, level: 2, targetAttainment: .5 });
    expect(group.targetGrading).toEqual({ averaged: true });
    const volume = buildHeatmapData(days, 'totalVolume', { todayDateKey: TODAY, weeks: 4,
      muscleTargets: { muscleIds: ['quads'], weeklyTarget: 1000 } });
    expect(volume.targetGrading).toBeUndefined();
    expect(volume.daily.find(day => day.hasTraining)).toMatchObject({ value: 100, level: 4 });
  });

  const daily: DailyEffortMetrics[] = [
    { dateKey: '2026-06-03', totalVolume: 100, workingSetCount: 2, estimatedRM1: 50, highestWeight: 40 },
    { dateKey: '2026-06-04', totalVolume: 300, workingSetCount: 1, estimatedRM1: 55, highestWeight: 60 },
  ];

  it('spans a Monday-aligned 52-week window ending today', () => {
    const data = buildHeatmapData([], 'totalVolume', { todayDateKey: TODAY });
    expect(data.weekly).toHaveLength(53);
    // 52 complete weeks plus Mon..Fri of the ongoing week.
    expect(data.daily).toHaveLength(369);
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
      { dateKey: '2024-07-10', totalVolume: 100, workingSetCount: 0, estimatedRM1: null, highestWeight: null },
      { dateKey: '2026-06-04', totalVolume: 300, workingSetCount: 0, estimatedRM1: null, highestWeight: null },
    ];
    const data = buildHeatmapData(old, 'totalVolume', { todayDateKey: TODAY, weeks: 'all' });
    // Monday of 2024-07-10 (a Wednesday) is 2024-07-08.
    expect(data.daily[0].dateKey).toBe('2024-07-08');
    expect(data.daily[data.daily.length - 1]).toMatchObject({ dateKey: TODAY, isToday: true });
    expect(data.daily.length).toBeGreaterThan(362);
  });

  it('with weeks: "all", never shrinks below the default 52-week window for sparse recent data', () => {
    const data = buildHeatmapData(daily, 'totalVolume', { todayDateKey: TODAY, weeks: 'all' });
    expect(data.weekly).toHaveLength(53);
    expect(data.daily).toHaveLength(369);
  });

  it('renders an all-rest grid for empty input', () => {
    const data = buildHeatmapData([], 'totalVolume', { todayDateKey: TODAY });
    expect(data.daily.every((d) => d.level === 0 && d.value === 0)).toBe(true);
    expect(data.weekly.every((w) => w.level === 0 && w.value === 0 && w.sessions === 0)).toBe(true);
  });

  it('defaults to the local today and the 52-week window when no options are passed', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 5, 12, 0));
    try {
      const data = buildHeatmapData([], 'totalVolume');
      expect(data.todayDateKey).toBe(TODAY);
      expect(data.weekly).toHaveLength(53);
    } finally {
      jest.useRealTimers();
    }
  });

  it('with weeks: "all" and no data, falls back to the default 52-week window', () => {
    const data = buildHeatmapData([], 'totalVolume', { todayDateKey: TODAY, weeks: 'all' });
    expect(data.weekly).toHaveLength(53);
    expect(data.daily).toHaveLength(369);
  });

  it('honours an explicit window length in weeks', () => {
    const data = buildHeatmapData(daily, 'totalVolume', { todayDateKey: TODAY, weeks: 2 });
    expect(data.weekly.map((w) => w.weekStartDateKey)).toEqual(['2026-05-18', '2026-05-25', '2026-06-01']);
    expect(data.daily[0].dateKey).toBe('2026-05-18');
    expect(data.daily).toHaveLength(19);
  });

  it('marks each day with its Monday-based row and week, and only today as today', () => {
    const data = buildHeatmapData(daily, 'totalVolume', { todayDateKey: TODAY, weeks: 1 });
    expect(data.daily.slice(-5).map((d) => [d.dateKey, d.dow, d.weekStartDateKey, d.isToday, d.hasTraining])).toEqual([
      ['2026-06-01', 0, '2026-06-01', false, false],
      ['2026-06-02', 1, '2026-06-01', false, false],
      ['2026-06-03', 2, '2026-06-01', false, true],
      ['2026-06-04', 3, '2026-06-01', false, true],
      ['2026-06-05', 4, '2026-06-01', true, false],
    ]);
  });

  it('buckets weeks across the observed weekly range, earlier weeks included', () => {
    const twoWeeks: DailyEffortMetrics[] = [
      { dateKey: '2026-05-26', totalVolume: 500, workingSetCount: 5, estimatedRM1: 70, highestWeight: 70 },
      { dateKey: '2026-06-02', totalVolume: 100, workingSetCount: 1, estimatedRM1: 50, highestWeight: 50 },
    ];
    const data = buildHeatmapData(twoWeeks, 'totalVolume', { todayDateKey: TODAY, weeks: 2 });
    expect(data.weekly.map((w) => [w.weekStartDateKey, w.value, w.level, w.isCurrentWeek])).toEqual([
      ['2026-05-18', 0, 0, false],
      ['2026-05-25', 500, 4, false],
      ['2026-06-01', 100, 1, true],
    ]);
  });

  it('keeps the best known value for best-of metrics in the weekly cell', () => {
    const data = buildHeatmapData(daily, 'estimatedRM1', { todayDateKey: TODAY, weeks: 1 });
    expect(data.weekly.at(-1)).toMatchObject({ value: 55, unavailable: false, hasTraining: true, sessions: 2 });
    expect(data.daily.find((d) => d.dateKey === '2026-06-03')).toMatchObject({ value: 50, unavailable: false });
  });

  it('marks a best-of week unavailable when every training day lacks the metric', () => {
    const noLoad: DailyEffortMetrics[] = [
      { dateKey: '2026-06-03', totalVolume: 0, workingSetCount: 1, estimatedRM1: null, highestWeight: null },
    ];
    const data = buildHeatmapData(noLoad, 'highestWeight', { todayDateKey: TODAY, weeks: 1 });
    expect(data.daily.find((d) => d.dateKey === '2026-06-03')).toMatchObject({ value: 0, unavailable: true });
    expect(data.weekly.at(-1)).toMatchObject({ value: 0, level: 0, unavailable: true, hasTraining: true, sessions: 1 });
  });

  it('marks an overflowed volume day and its week unavailable, with no subtotal', () => {
    const partial: DailyEffortMetrics[] = [
      { dateKey: '2026-06-02', totalVolume: 200, workingSetCount: 2, estimatedRM1: 60, highestWeight: 60 },
      { dateKey: '2026-06-03', totalVolume: null, workingSetCount: 2, estimatedRM1: 60, highestWeight: 60 },
    ];
    const data = buildHeatmapData(partial, 'totalVolume', { todayDateKey: TODAY, weeks: 1 });
    expect(data.daily.find((d) => d.dateKey === '2026-06-03')).toMatchObject({ value: 0, unavailable: true });
    expect(data.daily.find((d) => d.dateKey === '2026-06-03')).not.toHaveProperty('knownValue');
    expect(data.weekly.at(-1)).toMatchObject({ value: 0, level: 0, unavailable: true, sessions: 2 });
  });

  it('marks a volume week unavailable when the weekly sum overflows', () => {
    const huge: DailyEffortMetrics[] = [
      { dateKey: '2026-06-02', totalVolume: Number.MAX_VALUE, workingSetCount: 1, estimatedRM1: null, highestWeight: null },
      { dateKey: '2026-06-03', totalVolume: Number.MAX_VALUE, workingSetCount: 1, estimatedRM1: null, highestWeight: null },
    ];
    const data = buildHeatmapData(huge, 'totalVolume', { todayDateKey: TODAY, weeks: 1 });
    expect(data.weekly.at(-1)).toMatchObject({ value: 0, unavailable: true });
  });
});


it('distinguishes a warm-up-only day with zero working sets from missing load and rest', () => {
  const day = { dateKey: '2026-06-04', totalVolume: null, workingSetCount: 0, estimatedRM1: null, highestWeight: null };
  const counts = buildHeatmapData([day], 'workingSetCount', { todayDateKey: '2026-06-05' });
  expect(counts.daily.find(row => row.dateKey === day.dateKey)).toMatchObject({ value: 0, hasTraining: true, unavailable: false });
  expect(counts.daily.find(row => row.dateKey === '2026-06-05')).toMatchObject({ value: 0, hasTraining: false, unavailable: false });
  const volume = buildHeatmapData([day], 'totalVolume', { todayDateKey: '2026-06-05' });
  expect(volume.daily.find(row => row.dateKey === day.dateKey)).toMatchObject({ hasTraining: true, unavailable: true });
});
