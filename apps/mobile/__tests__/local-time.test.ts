import { formatDateTimeStamp } from '@/components/session-list';
import { formatClockTime, formatLocalDateTime, formatMonthDayTime } from '@/src/utils/local-time';

// Instants are built from local wall-clock fields, so each expectation holds in
// every time zone; run under a non-UTC `TZ` to see the stored UTC clock differ.
describe('local time labels', () => {
  it('formats an instant on the device clock', () => {
    const at = new Date(2026, 8, 7, 6, 4).getTime();

    expect(formatClockTime(at)).toBe('06:04');
    expect(formatMonthDayTime(at)).toBe('9/7 06:04');
    expect(formatLocalDateTime(at)).toBe('2026-09-07 06:04');
  });

  it('reads a stored ISO stamp as local time, including the local date', () => {
    expect(formatDateTimeStamp(new Date(2026, 8, 16, 10, 0).toISOString())).toBe('9/16 10:00');
    expect(formatDateTimeStamp(new Date(2026, 8, 17, 0, 30).toISOString())).toBe('9/17 00:30');
  });
});
