/**
 * Local calendar windows. The suite runs in Europe/London (jest.config.js):
 * in 2026 the clocks go forward on Sunday 29 March and back on Sunday
 * 25 October, so the weeks and months holding those days are 1 h short or long.
 */
import {
  daysInLocalMonth,
  isInWindow,
  localMonthWindow,
  localWeekWindow,
  startOfLocalDay,
} from '@/src/utils/local-calendar';

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

describe('localMonthWindow', () => {
  it('runs from the 1st 00:00 to the next 1st 00:00, local, across a DST change', () => {
    const march = localMonthWindow(local(2026, 3, 15));
    expect(march).toEqual({ start: local(2026, 3, 1), end: local(2026, 4, 1) });
    expect(march.end.toISOString()).toBe('2026-03-31T23:00:00.000Z');
    expect(lengthInHours(march)).toBe(31 * 24 - 1);
  });

  it('steps back to the previous month across a year boundary', () => {
    expect(localMonthWindow(local(2026, 1, 1, 0, 30), -1)).toEqual({ start: local(2025, 12, 1), end: local(2026, 1, 1) });
  });
});

describe('day helpers', () => {
  it('counts the days in a month, leap years included', () => {
    expect(daysInLocalMonth(local(2026, 2, 10))).toBe(28);
    expect(daysInLocalMonth(local(2028, 2, 10))).toBe(29);
    expect(daysInLocalMonth(local(2026, 10, 31, 23, 59))).toBe(31);
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
    expect(() => localMonthWindow(invalid)).toThrow('valid Date');
    expect(() => startOfLocalDay(invalid)).toThrow('valid Date');
    expect(() => daysInLocalMonth(invalid)).toThrow('valid Date');
  });
});
