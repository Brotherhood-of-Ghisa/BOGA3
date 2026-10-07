import { buildCalendarMonths } from '@/components/heatmaps/daily-calendar';
import { buildHeatmapData } from '@/components/heatmaps';
import type { DailyEffortMetrics } from '@/src/data';

const source = (dateKey: string, value: number): DailyEffortMetrics => ({ dateKey, totalVolume: value,
  workingSetCount: value, estimatedRM1: value, highestWeight: value });
const samples = [source('2026-08-31', 100), source('2026-09-01', 200), source('2026-10-05', 300)];

it.each(['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight'] as const)(
  'retains the weekly %s aggregation and independent heat across month boundaries', metric => {
    const data = buildHeatmapData(samples, metric, { todayDateKey: '2026-10-06', weeks: 7 });
    const months = buildCalendarMonths(data);
    expect(months.map(month => month.title)).toEqual(['October 2026', 'September 2026', 'August 2026']);
    const occurrences = months.flatMap(month => month.weeks).filter(week => week.weekStartDateKey === '2026-08-31');
    expect(occurrences).toHaveLength(2);
    for (const row of occurrences) {
      expect(row.week).toBe(data.weekly.find(week => week.weekStartDateKey === '2026-08-31'));
      expect(row.week?.value).toBe(metric === 'totalVolume' || metric === 'workingSetCount' ? 300 : 200);
      expect(row.days.map(day => day.dateKey)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02',
        '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
    }
    expect(months[1].weeks[0].days[0].inMonth).toBe(false);
    expect(months[2].weeks.at(-1)?.days[1].inMonth).toBe(false);
  });

it('fills the current month through Sunday with future cells and unscored future weeks', () => {
  const data = buildHeatmapData(samples, 'totalVolume', { todayDateKey: '2026-10-06', weeks: 1 });
  const months = buildCalendarMonths(data);
  expect(months.map(month => month.key)).toEqual(['2026-10']);
  expect(months[0].weeks.map(week => week.weekStartDateKey)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  expect(months[0].weeks[0].week?.value).toBe(300);
  expect(months[0].weeks[0].days[1].day?.isToday).toBe(true);
  expect(months[0].weeks[0].days[2]).toMatchObject({ dateKey: '2026-10-07', future: true, day: undefined });
  expect(months[0].weeks[1].week).toBeUndefined();
  expect(months[0].weeks.at(-1)?.days.at(-1)?.dateKey).toBe('2026-11-01');
});

it('keeps zero, unavailable and target attainment distinct without recalculating them', () => {
  const data = buildHeatmapData([source('2026-09-28', 0),
    { ...source('2026-09-29', 0), totalVolume: null }],
  'totalVolume', { todayDateKey: '2026-10-06', weeks: 2 });
  const row = buildCalendarMonths(data)[0].weeks[0];
  expect(row.days[0].day).toMatchObject({ value: 0, hasTraining: true, unavailable: false });
  expect(row.days[1].day).toMatchObject({ unavailable: true });
  expect(row.week).toMatchObject({ unavailable: true });
  const targeted = buildHeatmapData([{ ...source('2026-10-05', 3), workingSetCountsByMuscle: { chest: 3 } }],
    'workingSetCount', { todayDateKey: '2026-10-06', weeks: 1, muscleTargets: { muscleIds: ['chest'], weeklyTarget: 10 } });
  expect(buildCalendarMonths(targeted)[0].weeks[0].week).toMatchObject({ targetAttainment: .3, level: 2 });
});

it('handles leap February, Sunday month starts, year transitions and long saved windows', () => {
  const leap = buildCalendarMonths(buildHeatmapData([], 'totalVolume', { todayDateKey: '2024-02-29', weeks: 6 }));
  expect(leap[0].weeks.at(-1)?.days[3].dateKey).toBe('2024-02-29');
  const years = buildCalendarMonths(buildHeatmapData([], 'totalVolume', { todayDateKey: '2026-02-01', weeks: 104 }));
  expect(years[0].weeks[0].days[0].dateKey).toBe('2026-01-26');
  expect(years[0].weeks[0].days[6]).toMatchObject({ dateKey: '2026-02-01', inMonth: true });
  expect(years.some(month => month.title === 'December 2025')).toBe(true);
  expect(years.at(-1)?.key).toBe('2024-02');
});

it('renders no months for an empty adapter series', () => {
  expect(buildCalendarMonths({ daily: [], weekly: [], todayDateKey: '2026-10-06' })).toEqual([]);
});
