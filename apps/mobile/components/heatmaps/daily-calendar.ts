import type { DayCell, HeatmapData, WeekCell } from './heatmapData';

export type CalendarDay = {
  dateKey: string;
  future: boolean;
  day?: DayCell;
};

export type CalendarWeek = {
  weekStartDateKey: string;
  startDay: number;
  days: CalendarDay[];
  week?: WeekCell;
};

export type CalendarMonth = {
  key: string;
  title: string;
  weeks: CalendarWeek[];
};

const DAY_MS = 86400000;
const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const date = (key: string) => new Date(`${key}T00:00:00Z`);
const key = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (value: Date, count: number) => new Date(value.getTime() + count * DAY_MS);
const monday = (value: Date) => addDays(value, -(value.getUTCDay() + 6) % 7);

// Calendar framing: months and week rows newest first, each row in the month its
// Monday falls in; adapter values/colours are reused.
export function buildCalendarMonths(data: HeatmapData): CalendarMonth[] {
  const firstKey = data.daily[0]?.dateKey;
  if (!firstKey) return [];
  const days = new Map(data.daily.map(day => [day.dateKey, day]));
  const weeks = new Map(data.weekly.map(week => [week.weekStartDateKey, week]));
  const months = new Map<string, CalendarMonth>();
  for (let row = monday(date(firstKey)); key(row) <= data.todayDateKey; row = addDays(row, 7)) {
    const weekStartDateKey = key(row);
    const monthKey = weekStartDateKey.slice(0, 7);
    let month = months.get(monthKey);
    if (!month) {
      month = { key: monthKey, title: monthFormatter.format(row), weeks: [] };
      months.set(monthKey, month);
    }
    const rowDays = Array.from({ length: 7 }, (_, index) => {
      const dateKey = key(addDays(row, index));
      return { dateKey, future: dateKey > data.todayDateKey, day: days.get(dateKey) };
    });
    const fullWeek = rowDays.every(day => !!day.day && !day.future);
    month.weeks.push({ weekStartDateKey, startDay: row.getUTCDate(), days: rowDays,
      week: fullWeek ? weeks.get(weekStartDateKey) : undefined });
  }
  return [...months.values()].reverse().map(month => ({ ...month, weeks: month.weeks.reverse() }));
}
