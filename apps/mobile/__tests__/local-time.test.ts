import { formatDateTimeStamp } from '@/components/session-list';
import {
  formatClockTime,
  formatCompactDate,
  formatCompactDateRange,
  formatCompactDateTime,
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

  it("writes Today's compact dates: the year once, closing a date or a range", () => {
    expect(formatCompactDate(new Date(2026, 9, 26))).toBe('26 Oct 26');
    expect(formatCompactDate(new Date(2009, 0, 5))).toBe('5 Jan 09');
    expect(formatCompactDateTime(new Date(2026, 9, 26, 6, 10).getTime())).toBe('26 Oct 26 06:10');
    expect(formatCompactDateRange(new Date(2026, 9, 12), new Date(2026, 9, 18))).toBe('12 – 18 Oct 26');
    expect(formatCompactDateRange(new Date(2026, 9, 26), new Date(2026, 10, 1))).toBe('26 Oct – 1 Nov 26');
    expect(formatCompactDateRange(new Date(2026, 11, 28), new Date(2027, 0, 3))).toBe('28 Dec 26 – 3 Jan 27');
  });

  it('writes a dash for an invalid compact date', () => {
    const invalid = new Date(Number.NaN);
    expect(formatCompactDate(invalid)).toBe('—');
    expect(formatCompactDateTime(Number.NaN)).toBe('—');
    expect(formatCompactDateRange(invalid, new Date(2026, 9, 18))).toBe('—');
  });
});
