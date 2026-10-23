/**
 * Calendar windows in the device's time zone: Monday-start weeks and fixed
 * periods of whole weeks. Each window is half-open, `start <= t < end`, and both edges are
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

export const isInWindow = (instant: Date, window: LocalWindow): boolean =>
  instant.getTime() >= window.start.getTime() && instant.getTime() < window.end.getTime();

/**
 * Monday 29 December 2025, the first day of ISO week 1 of 2026: the first day
 * of a Today period. Built from local fields at each use, so it stays a Monday
 * in whatever zone the device is in now.
 */
export const periodAnchor = (days = 0): Date => new Date(2025, 11, 29 + days);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole local calendar days from `from`'s day to `to`'s day; DST never shifts the count. */
export const localDaysBetween = (from: Date, to: Date): number => {
  ensureValidDate(from);
  ensureValidDate(to);
  const day = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((day(to) - day(from)) / DAY_MS);
};

/**
 * The fixed `weeks`-week period around `now` ([[comparison.window]]): periods
 * run back to back from `periodAnchor()` (and before it), never resetting at a
 * new year. `offset` -1 is the previous period.
 */
export const localPeriodWindow = (now: Date, weeks: number, offset = 0): LocalWindow => {
  if (!Number.isInteger(weeks) || weeks < 1) throw new Error('weeks must be a positive whole number');
  const days = weeks * 7;
  const index = Math.floor(localDaysBetween(periodAnchor(), now) / days) + offset;
  return { start: periodAnchor(index * days), end: periodAnchor((index + 1) * days) };
};
