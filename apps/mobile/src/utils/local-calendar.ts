/**
 * Calendar windows in the device's time zone: Monday-start weeks and calendar
 * months. Each window is half-open, `start <= t < end`, and both edges are
 * built from local date fields, so a DST change lengthens or shortens the
 * window instead of moving its edges off local midnight.
 */

export type LocalWindow = { start: Date; end: Date };

const ensureValidDate = (value: Date): Date => {
  if (Number.isNaN(value.getTime())) throw new Error('date must be a valid Date');
  return value;
};

/** Local 00:00 of the day `days` after `date`'s day (0 is the same day). */
export const startOfLocalDay = (date: Date, days = 0): Date => {
  ensureValidDate(date);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
};

/** Monday 00:00 to the next Monday 00:00 around `now`; `offset` -1 is last week. */
export const localWeekWindow = (now: Date, offset = 0): LocalWindow => {
  ensureValidDate(now);
  const monday = now.getDate() - ((now.getDay() + 6) % 7) + offset * 7;
  return {
    start: new Date(now.getFullYear(), now.getMonth(), monday),
    end: new Date(now.getFullYear(), now.getMonth(), monday + 7),
  };
};

/** The 1st 00:00 to the next month's 1st 00:00 around `now`; `offset` -1 is last month. */
export const localMonthWindow = (now: Date, offset = 0): LocalWindow => {
  ensureValidDate(now);
  return {
    start: new Date(now.getFullYear(), now.getMonth() + offset, 1),
    end: new Date(now.getFullYear(), now.getMonth() + offset + 1, 1),
  };
};

/** Days in the local month that `date` falls in. */
export const daysInLocalMonth = (date: Date): number => {
  ensureValidDate(date);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
};

export const isInWindow = (instant: Date, window: LocalWindow): boolean =>
  instant.getTime() >= window.start.getTime() && instant.getTime() < window.end.getTime();
