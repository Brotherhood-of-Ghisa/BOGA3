/** Calendar windows use local Mondays and preserve wall time across DST. */
export const shiftCalendarWeeks = (date: Date, weeks: number): Date => {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + weeks * 7);
  return shifted;
};

export const calendarWeekBounds = (weeks: number, now = new Date()) => {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  return { start: shiftCalendarWeeks(monday, 1 - weeks), end: new Date(now) };
};

/** History sample coverage follows [[comparison.history-window]]. */
export const historyWeekBounds = (weeks: number, now = new Date()) =>
  calendarWeekBounds(weeks + (now.getDay() === 0 ? 0 : 1), now);

export const localDateKey = (date: Date): string =>
  `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** One local Monday–Sunday week from its `YYYY-MM-DD` Monday key; `end` is the next Monday, exclusive. */
export const localWeekBounds = (weekStartDateKey: string) => {
  const [year, month, day] = weekStartDateKey.split('-').map(Number);
  const start = new Date(year, month - 1, day);
  return { start, end: shiftCalendarWeeks(start, 1) };
};
