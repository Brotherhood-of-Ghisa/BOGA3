import { buildCalendarMonths } from '@/components/heatmaps/daily-calendar';
import { buildHeatmapData } from '@/components/heatmaps';
import type { DailyEffortMetrics } from '@/src/data';

const source = (dateKey: string, value: number): DailyEffortMetrics => ({ dateKey, totalVolume: value,
  workingSetCount: value, estimatedRM1: value, highestWeight: value });
const samples = [source('2026-08-31', 100), source('2026-09-01', 200), source('2026-10-05', 300)];

it.each(['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight'] as const)(
  'places the full cross-month %s week only in its Monday month', metric => {
    const data = buildHeatmapData(samples, metric, { todayDateKey: '2026-10-06', weeks: 7 });
    const months = buildCalendarMonths(data);
    expect(months.map(month => month.title)).toEqual(['October 2026', 'September 2026', 'August 2026']);
    const august = months[2].weeks.find(week => week.weekStartDateKey === '2026-08-31')!;
    expect(months[1].weeks.find(week => week.weekStartDateKey === '2026-08-31')).toBeUndefined();
    expect(august.week).toBe(data.weekly.find(week => week.weekStartDateKey === '2026-08-31'));
    expect(august.week?.value).toBe(metric === 'totalVolume' || metric === 'workingSetCount' ? 300 : 200);
    expect(august.days[0].day).toMatchObject({ dateKey: '2026-08-31' });
    expect(august.days[1].day).toMatchObject({ dateKey: '2026-09-01' });
  });

it('orders each month newest first and represents every sampled day exactly once', () => {
  const months = buildCalendarMonths(buildHeatmapData(samples, 'totalVolume', { todayDateKey: '2026-10-06', weeks: 7 }));
  const september = months[1];
  expect(september.weeks.map(week => week.weekStartDateKey)).toEqual(['2026-09-28', '2026-09-21', '2026-09-14', '2026-09-07']);
  expect(september.weeks[0].days[2]).toMatchObject({ dateKey: '2026-09-30' });
  expect(september.weeks.at(-1)?.days[1]).toMatchObject({ dateKey: '2026-09-08' });
  const keys = months.flatMap(month => month.weeks.flatMap(week => week.days.filter(day => day.day && !day.future).map(day => day.dateKey)));
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys.filter(key => key.startsWith('2026-09')).sort()).toEqual(
    Array.from({ length: 30 }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`));
});

it('frames the current week with unobserved future positions and no Week tile', () => {
  const months = buildCalendarMonths(buildHeatmapData(samples, 'totalVolume', { todayDateKey: '2026-10-06', weeks: 1 }));
  expect(months.map(month => month.key)).toEqual(['2026-10']);
  expect(months[0].weeks.map(week => week.weekStartDateKey)).toEqual(['2026-10-05']);
  expect(months[0].weeks[0].week).toBeUndefined();
  expect(months[0].weeks[0].days[1].day?.isToday).toBe(true);
  expect(months[0].weeks[0].days[2]).toMatchObject({ dateKey: '2026-10-07', future: true, day: undefined });
});

it.each(['2026-10-06', '2026-10-11', '2026-10-12'])('shows a seven-day Week tile on Sunday and afterwards (%s)', todayDateKey => {
  const data = buildHeatmapData(samples, 'totalVolume', { todayDateKey, weeks: 2 });
  const row = buildCalendarMonths(data)[0].weeks.find(week => week.weekStartDateKey === '2026-10-05')!;
  expect(row.week).toBe(todayDateKey >= '2026-10-11'
    ? data.weekly.find(week => week.weekStartDateKey === '2026-10-05') : undefined);
});

it('keeps known zero, unavailable and completed-week target values unchanged', () => {
  const data = buildHeatmapData([source('2026-09-28', 0), { ...source('2026-09-29', 0), totalVolume: null }],
    'totalVolume', { todayDateKey: '2026-10-06', weeks: 2 });
  const months = buildCalendarMonths(data);
  const september = months[1].weeks[0];
  expect(september.days[0].day).toMatchObject({ value: 0, hasTraining: true, unavailable: false });
  expect(september.days[1].day).toMatchObject({ unavailable: true });
  expect(september.week).toMatchObject({ unavailable: true });
  const targeted = buildHeatmapData([{ ...source('2026-10-05', 3), workingSetCountsByMuscle: { chest: 3 } }],
    'workingSetCount', { todayDateKey: '2026-10-12', weeks: 2, muscleTargets: { muscleIds: ['chest'], weeklyTarget: 10 } });
  expect(buildCalendarMonths(targeted)[0].weeks[1].week).toMatchObject({ targetAttainment: .3, level: 2 });
});

it('handles leap February, Sunday month starts, year transitions and long windows', () => {
  const leap = buildCalendarMonths(buildHeatmapData([], 'totalVolume', { todayDateKey: '2024-02-29', weeks: 6 }));
  expect(leap[0].weeks[0].days[3].dateKey).toBe('2024-02-29');
  expect(leap[0].weeks[0].week).toBeUndefined();
  const sunday = buildCalendarMonths(buildHeatmapData([source('2026-01-26', 100)], 'totalVolume', { todayDateKey: '2026-02-02', weeks: 104 }));
  expect(sunday[1].weeks[0].days[6]).toMatchObject({ dateKey: '2026-02-01' });
  expect(sunday[1].weeks[0].week?.weekStartDateKey).toBe('2026-01-26');
  expect(sunday.some(month => month.title === 'December 2025')).toBe(true);
  const years = buildCalendarMonths(buildHeatmapData([source('2026-12-28', 100), source('2027-01-03', 200)],
    'totalVolume', { todayDateKey: '2027-01-05', weeks: 3 }));
  expect(years[1].weeks[0].week?.value).toBe(300);
  expect(years[0].weeks[0].week).toBeUndefined();
});

it('renders no months for an empty adapter series', () => {
  expect(buildCalendarMonths({ daily: [], weekly: [], todayDateKey: '2026-10-06' })).toEqual([]);
});

it.each([1, 4, 52, 104])('keeps rows and unique completed Week tiles inside the saved %i-week bounds', weeks => {
  const data = buildHeatmapData(samples, 'totalVolume', { todayDateKey: '2026-10-06', weeks });
  const rows = buildCalendarMonths(data).flatMap(month => month.weeks);
  expect([...new Set(rows.map(row => row.weekStartDateKey))].sort()).toEqual(data.weekly.map(week => week.weekStartDateKey));
  const displayed = rows.filter(row => row.week).map(row => row.weekStartDateKey).sort();
  expect(displayed).toEqual(data.weekly.filter(week => !week.isCurrentWeek)
    .map(week => week.weekStartDateKey));
});

it.each(['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight'] as const)(
  'keeps a partial first sample week without its %s Week tile and counts subsequent rest days', metric => {
    const data = buildHeatmapData([source('2026-09-29', 100), source('2026-10-05', 200)],
      metric, { todayDateKey: '2026-10-11', weeks: 3 });
    data.daily = data.daily.filter(day => day.dateKey >= '2026-09-29');
    const months = buildCalendarMonths(data);
    expect(months[1].weeks[0].week).toBeUndefined();
    expect(months[1].weeks[0].days[1].day?.value).toBe(100);
    expect(months[0].weeks[0].week).toBe(data.weekly.find(week => week.weekStartDateKey === '2026-10-05'));
    expect(months[0].weeks[0].week?.sessions).toBe(1);
  });

it('checks all seven dates across months and rejects any absent calendar day', () => {
  const data = buildHeatmapData([source('2026-09-28', 100)], 'totalVolume', { todayDateKey: '2026-10-04', weeks: 1 });
  expect(buildCalendarMonths(data)[0].weeks[0].week).toBe(data.weekly[0]);
  data.daily = data.daily.filter(day => day.dateKey !== '2026-10-01');
  expect(buildCalendarMonths(data)[0].weeks[0].week).toBeUndefined();
});

it('counts sampled rest days even before the first workout or throughout a rest week', () => {
  for (const input of [[], [source('2026-10-11', 100)]]) {
    const data = buildHeatmapData(input, 'totalVolume', { todayDateKey: '2026-10-11', weeks: 2 });
    const displayed = buildCalendarMonths(data).flatMap(month => month.weeks)
      .filter(row => row.week).map(row => row.weekStartDateKey).sort();
    expect(displayed).toEqual(data.weekly.map(week => week.weekStartDateKey));
  }
});

it.each(['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight'] as const)(
  'includes a cross-month %s week on Sunday when Monday is sampled rest before the first workout', metric => {
    const data = buildHeatmapData([source('2026-09-29', 100), source('2026-10-04', 200)],
      metric, { todayDateKey: '2026-10-04', weeks: 1 });
    const months = buildCalendarMonths(data);
    expect(data.daily[0]).toMatchObject({ dateKey: '2026-09-28', hasTraining: false });
    expect(months[0].weeks[0].week).toBe(data.weekly[0]);
    expect(months[0].weeks[0].week?.value).toBe(metric === 'totalVolume' || metric === 'workingSetCount' ? 300 : 200);
    expect(months).toHaveLength(1);
  });

it.each([
  ['2026-09-28', '2026-10-04', '2026-09', 'September 2026'],
  ['2025-12-29', '2026-01-04', '2025-12', 'December 2025'],
])('attributes the entire week of %s to its start month', (start, today, monthKey, title) => {
  const data = buildHeatmapData([], 'totalVolume', { todayDateKey: today, weeks: 1 });
  const months = buildCalendarMonths(data);
  expect(months).toHaveLength(1);
  expect(months[0]).toMatchObject({ key: monthKey, title });
  expect(months[0].weeks).toHaveLength(1);
  expect(months[0].weeks[0]).toMatchObject({ weekStartDateKey: start, startDay: Number(start.slice(-2)) });
  expect(months[0].weeks[0].days.map(day => day.dateKey)).toEqual(data.daily.map(day => day.dateKey));
  expect(months[0].weeks[0].week).toEqual(data.weekly[0]);
});

it('retains a partial boundary row in Monday’s month, with no completed total', () => {
  const data = buildHeatmapData([], 'totalVolume', { todayDateKey: '2026-10-02', weeks: 1 });
  data.daily = data.daily.filter(day => day.dateKey >= '2026-10-01');
  const months = buildCalendarMonths(data);
  expect(months.map(month => month.key)).toEqual(['2026-09']);
  const row = months[0].weeks[0];
  expect(row.weekStartDateKey).toBe('2026-09-28');
  expect(row.week).toBeUndefined();
  expect(row.days.filter(day => day.day).map(day => day.dateKey)).toEqual(['2026-10-01', '2026-10-02']);
  expect(row.days.filter(day => day.future).map(day => day.dateKey)).toEqual(['2026-10-03', '2026-10-04']);
});
