/**
 * Local calendar windows. The suite runs in Europe/London (jest.config.js):
 * in 2026 the clocks go forward on Sunday 29 March and back on Sunday
 * 25 October, so the weeks and periods holding those days are 1 h short or long.
 */
import {
  isInWindow,
  localDaysBetween,
  localPeriodWindow,
  localWeekWindow,
  PERIOD_ANCHOR,
  startOfLocalDay,
} from '@/src/utils/local-calendar';
import { historyWeekBounds } from '@/src/utils/calendar-weeks';

const local = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);
const HOUR = 60 * 60 * 1000;
const lengthInHours = (window: { start: Date; end: Date }) =>
  (window.end.getTime() - window.start.getTime()) / HOUR;

it('runs in a zone that changes clocks, so the DST cases below mean something', () => {
  expect(new Date(Date.UTC(2026, 0, 15)).getTimezoneOffset()).not.toBe(
    new Date(Date.UTC(2026, 6, 15)).getTimezoneOffset(),
  );
});

describe('localWeekWindow', () => {
  it('runs Monday 00:00 to the next Monday 00:00, local', () => {
    const week = localWeekWindow(local(2026, 10, 1, 9)); // Thursday

    expect(week).toEqual({ start: local(2026, 9, 28), end: local(2026, 10, 5) });
    expect(week.start.getDay()).toBe(1);
  });

  it('puts Sunday 23:59 in the week that started the Monday before, and Monday 00:00 in the next', () => {
    expect(localWeekWindow(local(2026, 10, 4, 23, 59)).start).toEqual(local(2026, 9, 28));
    expect(localWeekWindow(local(2026, 10, 5, 0, 0)).start).toEqual(local(2026, 10, 5));
  });

  it('keeps both edges on local midnight across both DST changes', () => {
    const spring = localWeekWindow(local(2026, 3, 25, 12));
    expect(spring).toEqual({ start: local(2026, 3, 23), end: local(2026, 3, 30) });
    expect(spring.end.toISOString()).toBe('2026-03-29T23:00:00.000Z'); // BST midnight
    expect(lengthInHours(spring)).toBe(167);

    const autumn = localWeekWindow(local(2026, 10, 22, 12));
    expect(autumn).toEqual({ start: local(2026, 10, 19), end: local(2026, 10, 26) });
    expect(autumn.start.toISOString()).toBe('2026-10-18T23:00:00.000Z');
    expect(lengthInHours(autumn)).toBe(169);
  });

  it('steps back whole calendar weeks across a month and a year boundary', () => {
    const now = local(2026, 1, 1, 8); // Thursday
    expect(localWeekWindow(now)).toEqual({ start: local(2025, 12, 29), end: local(2026, 1, 5) });
    expect(localWeekWindow(now, -1)).toEqual({ start: local(2025, 12, 22), end: local(2025, 12, 29) });
  });
});

describe('localPeriodWindow', () => {
  it('starts at Monday 29 December 2025, the first day of ISO week 1 of 2026', () => {
    expect(PERIOD_ANCHOR).toEqual(local(2025, 12, 29));
    expect(PERIOD_ANCHOR.getDay()).toBe(1);
    expect(localPeriodWindow(local(2025, 12, 29), 4)).toEqual({ start: local(2025, 12, 29), end: local(2026, 1, 26) });
    expect(localPeriodWindow(local(2025, 12, 28, 23, 59), 4)).toEqual({ start: local(2025, 12, 1), end: local(2025, 12, 29) });
  });

  it('places today, Friday 23 October 2026, in the 4-week period from 5 October, local, across the autumn change', () => {
    const now = local(2026, 10, 23, 9);
    const period = localPeriodWindow(now, 4);
    expect(period).toEqual({ start: local(2026, 10, 5), end: local(2026, 11, 2) });
    expect(lengthInHours(period)).toBe(28 * 24 + 1);
    expect(localPeriodWindow(now, 4, -1)).toEqual({ start: local(2026, 9, 7), end: local(2026, 10, 5) });
  });

  it.each([
    [2, local(2026, 10, 19), local(2026, 11, 2)],
    [6, local(2026, 10, 19), local(2026, 11, 30)],
    [52, local(2025, 12, 29), local(2026, 12, 28)],
  ])('lays %i-week periods from the anchor, so changing the length moves the edges', (weeks, start, end) => {
    expect(localPeriodWindow(local(2026, 10, 23, 9), weeks)).toEqual({ start, end });
  });

  it('is the calendar week when a period is one week', () => {
    for (const now of [local(2025, 6, 4, 9), local(2026, 3, 29, 23, 59), local(2026, 10, 23, 9), local(2027, 1, 3)]) {
      expect(localPeriodWindow(now, 1)).toEqual(localWeekWindow(now));
    }
  });

  it('runs on through a 53-week ISO year without resetting at New Year', () => {
    // 2026 has 53 ISO weeks; Monday 4 January 2027, ISO week 1 of 2027, falls mid-period.
    expect(localPeriodWindow(local(2027, 1, 4, 12), 4)).toEqual({ start: local(2026, 12, 28), end: local(2027, 1, 25) });
    expect(localPeriodWindow(local(2027, 1, 4, 12), 4, -1)).toEqual({ start: local(2026, 11, 30), end: local(2026, 12, 28) });
  });

  it('extends back before the anchor', () => {
    expect(localPeriodWindow(local(2025, 11, 15, 12), 4)).toEqual({ start: local(2025, 11, 3), end: local(2025, 12, 1) });
  });

  it('rejects a length that is not a whole number of weeks', () => {
    expect(() => localPeriodWindow(local(2026, 10, 23), 0)).toThrow('positive whole number');
    expect(() => localPeriodWindow(local(2026, 10, 23), 1.5)).toThrow('positive whole number');
  });
});

describe('day helpers', () => {
  it('counts whole local days between two dates, across both DST changes and backwards', () => {
    expect(localDaysBetween(local(2026, 3, 28, 12), local(2026, 3, 30, 1))).toBe(2);
    expect(localDaysBetween(local(2026, 10, 24, 23, 59), local(2026, 10, 26))).toBe(2);
    expect(localDaysBetween(local(2026, 1, 1), local(2025, 12, 29, 23))).toBe(-3);
  });

  it('finds local midnight a number of days on, across the spring change', () => {
    expect(startOfLocalDay(local(2026, 3, 29, 12))).toEqual(local(2026, 3, 29));
    expect(startOfLocalDay(local(2026, 3, 29, 12), 1).toISOString()).toBe('2026-03-29T23:00:00.000Z');
  });

  it('treats a window as half-open', () => {
    const window = { start: local(2026, 10, 1), end: local(2026, 10, 2) };
    expect(isInWindow(window.start, window)).toBe(true);
    expect(isInWindow(new Date(window.end.getTime() - 1), window)).toBe(true);
    expect(isInWindow(window.end, window)).toBe(false);
  });

  it('rejects an invalid date', () => {
    const invalid = new Date(Number.NaN);
    expect(() => localWeekWindow(invalid)).toThrow('valid Date');
    expect(() => localPeriodWindow(invalid, 4)).toThrow('valid Date');
    expect(() => startOfLocalDay(invalid)).toThrow('valid Date');
    expect(() => localDaysBetween(invalid, invalid)).toThrow('valid Date');
  });
});

describe('complete-week history bounds', () => {
  it.each([5, 6, 7, 8, 9, 10, 11])('includes four complete weeks on October %i', day => {
    const now = local(2026, 10, day, 12);
    expect(historyWeekBounds(4, now)).toEqual({
      start: local(2026, 9, day === 11 ? 14 : 7), end: now,
    });
  });

  it.each([
    [1, 2026, 9, 28], [52, 2025, 10, 6], [520, 2016, 10, 17],
  ])('covers %i complete weeks before Friday', (weeks, year, month, day) => {
    expect(historyWeekBounds(weeks, local(2026, 10, 9)).start).toEqual(local(year, month, day));
  });

  it('keeps Monday midnight across a year, leap February and both DST transitions', () => {
    expect(historyWeekBounds(1, local(2027, 1, 1)).start).toEqual(local(2026, 12, 21));
    expect(historyWeekBounds(1, local(2028, 2, 29)).start).toEqual(local(2028, 2, 21));
    expect(historyWeekBounds(1, local(2026, 3, 30, 12)).start).toEqual(local(2026, 3, 23));
    expect(historyWeekBounds(1, local(2026, 10, 26, 12)).start).toEqual(local(2026, 10, 19));
    expect(historyWeekBounds(1, local(2026, 3, 29, 12)).start).toEqual(local(2026, 3, 23));
    expect(historyWeekBounds(1, local(2026, 10, 25, 12)).start).toEqual(local(2026, 10, 19));
  });
});
