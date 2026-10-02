import {
  END_BEFORE_START_MESSAGE,
  END_TIME_FORMAT_MESSAGE,
  formatSessionTimes,
  resolveSessionTimes,
  START_TIME_FORMAT_MESSAGE,
  validateSessionTimes,
} from '@/src/session-recorder/session-times';

// A completed session's stored instants carry seconds; the fields show minutes.
const persisted = {
  startedAt: new Date(2026, 1, 25, 10, 0, 30),
  completedAt: new Date(2026, 1, 25, 10, 45, 10),
};

describe('completed-session times', () => {
  it('shows the stored instants as YYYY-MM-DD HH:mm', () => {
    expect(formatSessionTimes(persisted)).toEqual({ start: '2026-02-25 10:00', end: '2026-02-25 10:45' });
  });

  it('validates each field with the completed-edit messages', () => {
    expect(validateSessionTimes({ start: '2026-02-25 10:00', end: '2026-02-25 10:45' })).toEqual({
      start: null,
      end: null,
    });
    expect(validateSessionTimes({ start: '2026-02-30 10:00', end: '25/02/2026' })).toEqual({
      start: START_TIME_FORMAT_MESSAGE,
      end: END_TIME_FORMAT_MESSAGE,
    });
    expect(validateSessionTimes({ start: '2026-02-25 10:00', end: '2026-02-25 09:59' })).toEqual({
      start: null,
      end: END_BEFORE_START_MESSAGE,
    });
    // Equal is allowed; with an invalid Start, End is only checked for format.
    expect(validateSessionTimes({ start: '2026-02-25 10:00', end: '2026-02-25 10:00' }).end).toBeNull();
    expect(validateSessionTimes({ start: 'x', end: '2026-02-25 09:00' }).end).toBeNull();
  });

  it('resolves nothing while either field is invalid', () => {
    expect(resolveSessionTimes({ start: 'x', end: '2026-02-25 10:45' }, persisted)).toBeNull();
    expect(resolveSessionTimes({ start: '2026-02-25 10:00', end: '2026-02-25 09:00' }, persisted)).toBeNull();
  });

  it('keeps a stored instant while its field still shows it, and takes an edited minute exactly', () => {
    expect(resolveSessionTimes(formatSessionTimes(persisted), persisted)).toEqual(persisted);
    expect(resolveSessionTimes({ start: '2026-02-25 10:00', end: '2026-02-25 10:50' }, persisted)).toEqual({
      startedAt: persisted.startedAt,
      completedAt: new Date(2026, 1, 25, 10, 50),
    });
  });

  it('uses both edited minutes when mixing would put End before Start', () => {
    // Start keeps 10:00:30; an End edited to 10:00 would be 30 s earlier.
    expect(resolveSessionTimes({ start: '2026-02-25 10:00', end: '2026-02-25 10:00' }, persisted)).toEqual({
      startedAt: new Date(2026, 1, 25, 10, 0),
      completedAt: new Date(2026, 1, 25, 10, 0),
    });
  });
});
