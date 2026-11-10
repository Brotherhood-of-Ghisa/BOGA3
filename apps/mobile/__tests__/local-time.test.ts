import { formatDateTimeStamp } from '@/components/session-list';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import {
  formatCalendarDate,
  formatCalendarWeek,
  formatCalendarWeekHeading,
  formatClockTime,
  formatCompactDate,
  formatCompactDateRange,
  formatCompactDateTime,
  formatDayMonth,
  formatLocalDateTime,
  formatMonthDayTime,
} from '@/src/utils/local-time';

// Instants are built from local wall-clock fields, so each expectation holds in
// every time zone; run under a non-UTC `TZ` to see the stored UTC clock differ.
describe('local time labels', () => {
  it('formats an instant on the device clock', () => {
    const at = new Date(2026, 8, 7, 6, 4).getTime();

    expect(formatClockTime(at)).toBe('06:04');
    expect(formatMonthDayTime(at, 'DD-MM-YYYY')).toBe('07-09-2026 06:04');
    expect(formatMonthDayTime(at, 'DD-MM-YYYY')).toBe('07-09-2026 06:04');
    expect(formatMonthDayTime(at, 'MM-DD-YYYY')).toBe('09-07-2026 06:04');
    expect(formatMonthDayTime(at, 'YYYY-MM-DD')).toBe('2026-09-07 06:04');
    expect(formatLocalDateTime(at, 'DD-MM-YYYY')).toBe('07-09-2026 06:04');
  });

  it('reads a stored ISO stamp as local time, including the local date', () => {
    expect(formatDateTimeStamp(new Date(2026, 8, 16, 10, 0).toISOString(), 'DD-MM-YYYY')).toBe('16-09-2026 10:00');
    expect(formatDateTimeStamp(new Date(2026, 8, 16, 10, 0).toISOString(), 'DD-MM-YYYY')).toBe('16-09-2026 10:00');
    expect(formatDateTimeStamp(new Date(2026, 8, 16, 10, 0).toISOString(), 'MM-DD-YYYY')).toBe('09-16-2026 10:00');
    expect(formatDateTimeStamp(new Date(2026, 8, 16, 10, 0).toISOString(), 'YYYY-MM-DD')).toBe('2026-09-16 10:00');
    expect(formatDateTimeStamp(new Date(2026, 8, 17, 0, 30).toISOString(), 'DD-MM-YYYY')).toBe('17-09-2026 00:30');
    expect(formatDateTimeStamp(new Date(2026, 8, 17, 0, 30).toISOString(), 'DD-MM-YYYY')).toBe('17-09-2026 00:30');
  });

  describe.each<{
    dateFormat: ExerciseDateFormat;
    short: string;
    complete: string;
    numeric: string;
    earlyYear: string;
    sameMonth: string;
    crossMonth: string;
    crossYear: string;
    weekHeading: string;
    fullWeek: string;
  }>([
    {
      dateFormat: 'DD-MM-YYYY', short: '17 Sep', complete: '17 Sep 26', numeric: '17-09-2026', earlyYear: '5 Jan 09',
      sameMonth: '19 – 25 Oct 26', crossMonth: '26 Oct – 1 Nov 26', crossYear: '28 Dec 26 – 3 Jan 27',
      weekHeading: '29 Dec – 4 Jan 2026', fullWeek: '29-12-2025 – 04-01-2026',
    },
    {
      dateFormat: 'MM-DD-YYYY', short: 'Sep 17', complete: 'Sep 17 26', numeric: '09-17-2026', earlyYear: 'Jan 5 09',
      sameMonth: 'Oct 19 – 25 26', crossMonth: 'Oct 26 – Nov 1 26', crossYear: 'Dec 28 26 – Jan 3 27',
      weekHeading: 'Dec 29 – Jan 4 2026', fullWeek: '12-29-2025 – 01-04-2026',
    },
    {
      dateFormat: 'YYYY-MM-DD', short: 'Sep 17', complete: '2026 Sep 17', numeric: '2026-09-17', earlyYear: '2009 Jan 5',
      sameMonth: '2026 Oct 19 – 25', crossMonth: '2026 Oct 26 – Nov 1', crossYear: '2026 Dec 28 – 2027 Jan 3',
      weekHeading: '2026 Dec 29 – Jan 4', fullWeek: '2025-12-29 – 2026-01-04',
    },
  ])('$dateFormat family', ({ dateFormat, short, complete, numeric, earlyYear, sameMonth, crossMonth, crossYear, weekHeading, fullWeek }) => {
    it('pairs short and compact dates with the existing numeric format', () => {
      const date = new Date(2026, 8, 17, 6, 10);
      expect(formatDayMonth(date, dateFormat)).toBe(short);
      expect(formatCompactDate(date, dateFormat)).toBe(complete);
      expect(formatCompactDateTime(date.getTime(), dateFormat)).toBe(`${complete} 06:10`);
      expect(formatCompactDate(new Date(2009, 0, 5), dateFormat)).toBe(earlyYear);
      expect(formatCalendarDate('2026-09-17', dateFormat)).toBe(numeric);
      expect(formatLocalDateTime(date.getTime(), dateFormat)).toBe(`${numeric} 06:10`);
    });

    it('shares the month and year only when both endpoints allow it', () => {
      expect(formatCompactDateRange(new Date(2026, 9, 19), new Date(2026, 9, 25), dateFormat)).toBe(sameMonth);
      expect(formatCompactDateRange(new Date(2026, 9, 26), new Date(2026, 10, 1), dateFormat)).toBe(crossMonth);
      expect(formatCompactDateRange(new Date(2026, 11, 28), new Date(2027, 0, 3), dateFormat)).toBe(crossYear);
    });

    it('keeps calendar-week headings on their separate four-digit end-year rule', () => {
      expect(formatCalendarWeekHeading('2025-12-29', dateFormat)).toBe(weekHeading);
      expect(formatCalendarWeek('2025-12-29', dateFormat)).toBe(fullWeek);
    });

    it('converts a stored UTC instant to its local day without changing that instant', () => {
      // Jest pins Europe/London: the UTC date is the day before this local date.
      const stored = '2026-09-16T23:30:00.000Z';
      const date = new Date(stored);
      expect(formatCompactDateTime(date.getTime(), dateFormat)).toBe(`${complete} 00:30`);
      expect(formatLocalDateTime(date.getTime(), dateFormat)).toBe(`${numeric} 00:30`);
      expect(date.toISOString()).toBe(stored);
    });

    it('never mutates date or range inputs while displaying their family', () => {
      const start = new Date(2026, 9, 26, 6, 10);
      const end = new Date(2026, 10, 1, 7, 20);
      const instants = [start.getTime(), end.getTime()];
      formatCompactDate(start, dateFormat);
      formatCompactDateTime(start.getTime(), dateFormat);
      formatCompactDateRange(start, end, dateFormat);
      expect([start.getTime(), end.getTime()]).toEqual(instants);
    });

    it('writes a dash for an invalid compact date or either invalid endpoint', () => {
      const invalid = new Date(Number.NaN);
      const valid = new Date(2026, 9, 18);
      expect(formatDayMonth(invalid, dateFormat)).toBe('—');
      expect(formatCompactDate(invalid, dateFormat)).toBe('—');
      expect(formatCompactDateTime(Number.NaN, dateFormat)).toBe('—');
      expect(formatCompactDateRange(invalid, valid, dateFormat)).toBe('—');
      expect(formatCompactDateRange(valid, invalid, dateFormat)).toBe('—');
    });
  });
});
