import { formatDateTimeStamp } from '@/components/session-list';
import { formatClockTime, formatLocalDateTime, formatMonthDayTime } from '@/src/utils/local-time';

// Instants are built from local wall-clock fields, so each expectation holds in
// every time zone; run under a non-UTC `TZ` to see the stored UTC clock differ.
describe('local time labels', () => {
  it('formats an instant on the device clock', () => {
    const at = new Date(2026, 8, 7, 6, 4).getTime();

    expect(formatClockTime(at)).toBe('06:04');
    expect(formatMonthDayTime(at)).toBe('9/7 06:04');
    expect(formatMonthDayTime(at, 'DD-MM-YYYY')).toBe('7/9 06:04');
    expect(formatMonthDayTime(at, 'MM-DD-YYYY')).toBe('9/7 06:04');
    expect(formatMonthDayTime(at, 'YYYY-MM-DD')).toBe('2026-09-07 06:04');
    expect(formatLocalDateTime(at)).toBe('2026-09-07 06:04');
  });

  it('reads a stored ISO stamp as local time, including the local date', () => {
    expect(formatDateTimeStamp(new Date(2026, 8, 16, 10, 0).toISOString())).toBe('9/16 10:00');
    expect(formatDateTimeStamp(new Date(2026, 8, 16, 10, 0).toISOString(), 'DD-MM-YYYY')).toBe('16/9 10:00');
    expect(formatDateTimeStamp(new Date(2026, 8, 16, 10, 0).toISOString(), 'MM-DD-YYYY')).toBe('9/16 10:00');
    expect(formatDateTimeStamp(new Date(2026, 8, 16, 10, 0).toISOString(), 'YYYY-MM-DD')).toBe('2026-09-16 10:00');
    expect(formatDateTimeStamp(new Date(2026, 8, 17, 0, 30).toISOString())).toBe('9/17 00:30');
    expect(formatDateTimeStamp(new Date(2026, 8, 17, 0, 30).toISOString(), 'DD-MM-YYYY')).toBe('17/9 00:30');
  });
});
