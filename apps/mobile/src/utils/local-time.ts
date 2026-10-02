/**
 * Wall-clock labels in the device's time zone. Stored instants (ISO strings,
 * epoch ms) are UTC; every time the app shows is read locally from them here.
 */

const pad2 = (value: number): string => `${value}`.padStart(2, '0');

/** Local `HH:MM`. */
export const formatClockTime = (epochMs: number): string => {
  const date = new Date(epochMs);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

/** Local `M/D HH:MM`, the session list's start stamp. */
export const formatMonthDayTime = (epochMs: number): string => {
  const date = new Date(epochMs);
  return `${date.getMonth() + 1}/${date.getDate()} ${formatClockTime(epochMs)}`;
};

/** Local `YYYY-MM-DD HH:MM`. */
export const formatLocalDateTime = (epochMs: number): string => {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${formatClockTime(epochMs)}`;
};

/** Local `YYYY-MM-DD HH:MM` of a Date: the editable session and weigh-in stamp. */
export function formatCurrentDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/** Reads a local `YYYY-MM-DD HH:MM` stamp back; null unless it names a real wall-clock minute. */
export function parseSessionDateTime(dateTime: string): Date | null {
  const trimmed = dateTime.trim();
  const matched = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(trimmed);
  if (!matched) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = matched;
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
