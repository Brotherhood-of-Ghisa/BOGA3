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
