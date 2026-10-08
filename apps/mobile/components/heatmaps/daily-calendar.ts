import type { DayCell, HeatmapData, WeekCell } from './heatmapData';

export type CalendarDay = {
  dateKey: string;
  dayOfMonth: number;
  inMonth: boolean;
  future: boolean;
  day?: DayCell;
};

export type CalendarWeek = {
  weekStartDateKey: string;
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

// Newest-first month rows. Week tiles require seven covered calendar days,
// from the first recorded workout onwards, and appear in their Sunday's month.
export function buildCalendarMonths(data: HeatmapData): CalendarMonth[] {
  const firstKey = data.daily[0]?.dateKey;
  if (!firstKey) return [];
  const firstRecordedKey = data.daily.find(day => day.hasTraining)?.dateKey;
  const days = new Map(data.daily.map(day => [day.dateKey, day]));
  const weeks = new Map(data.weekly.map(week => [week.weekStartDateKey, week]));
  const months: CalendarMonth[] = [];
  const firstMonth = firstKey.slice(0, 7);
  const today = date(data.todayDateKey);
  for (let start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    key(start).slice(0, 7) >= firstMonth;
    start = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1))) {
    const monthKey = key(start).slice(0, 7);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const rows: CalendarWeek[] = [];
    for (let row = monday(start); row <= end && key(row) <= data.todayDateKey; row = addDays(row, 7)) {
      // Clip both ends to the saved Monday-aligned window; only the current
      // week retains blank future day placeholders.
      if (key(row) < firstKey) continue;
      const sundayKey = key(addDays(row, 6));
      const rowDays = Array.from({ length: 7 }, (_, index) => {
        const value = addDays(row, index);
        const dateKey = key(value);
        const inMonth = dateKey.startsWith(monthKey);
        return { dateKey, dayOfMonth: value.getUTCDate(), inMonth,
          future: dateKey > data.todayDateKey, day: inMonth ? days.get(dateKey) : undefined };
      });
      const fullWeek = firstRecordedKey && key(row) >= firstRecordedKey && rowDays.every(day => days.has(day.dateKey));
      rows.push({ weekStartDateKey: key(row), days: rowDays,
        week: fullWeek && sundayKey.startsWith(monthKey) && sundayKey <= data.todayDateKey ? weeks.get(key(row)) : undefined });
    }
    months.push({ key: monthKey, title: monthFormatter.format(start), weeks: rows.reverse() });
  }
  return months;
}
