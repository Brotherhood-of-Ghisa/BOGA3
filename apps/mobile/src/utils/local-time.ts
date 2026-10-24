/**
 * Wall-clock labels in the device's time zone. Stored instants (ISO strings,
 * epoch ms) are UTC; every time the app shows is read locally from them here.
 */

import type { ExerciseDateFormat } from '@/src/preferences/model';

const pad2 = (value: number): string => `${value}`.padStart(2, '0');

/** Local `HH:MM`. */
export const formatClockTime = (epochMs: number): string => {
  const date = new Date(epochMs);
  if (!Number.isFinite(date.getTime())) return '—';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

/** Local `YYYY-MM-DD` / `MM-DD-YYYY` / `DD-MM-YYYY`. */
export const formatShortDate = (date: Date, dateFormat: ExerciseDateFormat): string => {
  if (!Number.isFinite(date.getTime())) return '—';
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const year = date.getFullYear();
  if (dateFormat === 'YYYY-MM-DD') {
    return `${year}-${month}-${day}`;
  }
  if (dateFormat === 'MM-DD-YYYY') {
    return `${month}-${day}-${year}`;
  }
  return `${day}-${month}-${year}`;
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const formatMonthYear = (date: Date): string => `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;

/** `Oct 5`, or `5 Oct` when the selected format puts the day first: no year. */
export const formatDayMonth = (date: Date, dateFormat: ExerciseDateFormat): string => {
  if (!Number.isFinite(date.getTime())) return '—';
  const month = MONTH_NAMES[date.getMonth()].slice(0, 3);
  return dateFormat === 'DD-MM-YYYY' ? `${date.getDate()} ${month}` : `${month} ${date.getDate()}`;
};

/** A local calendar date and 24-hour clock in the user's selected format. */
export const formatLocalDateTime = (epochMs: number, dateFormat: ExerciseDateFormat): string => {
  const date = new Date(epochMs);
  return Number.isFinite(date.getTime()) ? `${formatShortDate(date, dateFormat)} ${formatClockTime(epochMs)}` : '—';
};

export const formatMonthDayTime = formatLocalDateTime;

/** Canonical local form state, never a display label. */
export const formatCurrentDateTime = (date: Date): string => formatLocalDateTime(date.getTime(), 'YYYY-MM-DD');

/** A calendar key is a day, not a UTC instant: preserve it in every time zone. */
export const formatCalendarDate = (key: string, dateFormat: ExerciseDateFormat): string =>
  formatShortDate(new Date(`${key}T12:00:00`), dateFormat);

/** A Monday key from the calendar adapter, formatted without changing its day. */
export const formatCalendarWeek = (key: string, dateFormat: ExerciseDateFormat): string => {
  const start = new Date(`${key}T12:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return formatDateRange(start, end, dateFormat);
};

/** Inclusive range of calendar days; callers supply the actual last day. */
export const formatDateRange = (start: Date, end: Date, dateFormat: ExerciseDateFormat): string =>
  `${formatShortDate(start, dateFormat)} – ${formatShortDate(end, dateFormat)}`;

/** Preserve an unfinished/invalid edit while switching the selected format. */
export const reformatDateTime = (text: string, from: ExerciseDateFormat, to: ExerciseDateFormat): string => {
  const date = parseSessionDateTime(text, from);
  return date ? formatLocalDateTime(date.getTime(), to) : text;
};

/** Parses a selected-format local wall-clock minute; internal form state defaults to ISO order. */
export function parseSessionDateTime(dateTime: string, dateFormat: ExerciseDateFormat = 'YYYY-MM-DD'): Date | null {
  const trimmed = dateTime.trim();
  const pattern = dateFormat === 'YYYY-MM-DD' ? /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/ : /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})$/;
  const matched = pattern.exec(trimmed);
  if (!matched) {
    return null;
  }

  const [, first, second, third, hourText, minuteText] = matched;
  const [yearText, monthText, dayText] = dateFormat === 'YYYY-MM-DD' ? [first, second, third]
    : dateFormat === 'MM-DD-YYYY' ? [third, first, second] : [third, second, first];
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if ([year, month, day, hour, minute].some((value) => Number.isNaN(value))) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    return null;
  }

  return parsed;
}
