import { act, renderHook } from '@testing-library/react-native';

import {
  __resetRestTimerForTests,
  adjustRestTimer,
  deriveRestTimerView,
  dismissRestTimer,
  formatRestTimerSeconds,
  getRestTimerEntry,
  REST_TIMER_STEP_SEC,
  restartRestTimer,
  startRestTimer,
  useSessionRestTimer,
} from '@/src/session-recorder/rest-timer';

describe('rest-timer store and pure rules', () => {
  beforeEach(() => {
    __resetRestTimerForTests();
    jest.useRealTimers();
  });

  afterEach(() => {
    __resetRestTimerForTests();
    jest.useRealTimers();
  });

  it('formats remaining seconds as M:SS and clamps negative values to 0:00', () => {
    expect(formatRestTimerSeconds(90)).toBe('1:30');
    expect(formatRestTimerSeconds(65)).toBe('1:05');
    expect(formatRestTimerSeconds(9)).toBe('0:09');
    expect(formatRestTimerSeconds(0)).toBe('0:00');
    expect(formatRestTimerSeconds(-12)).toBe('0:00');
  });

  it('derives idle, running, and completed views scoped to the active session', () => {
    expect(deriveRestTimerView(null, 'session-1', 1_000)).toEqual({ status: 'idle' });

    startRestTimer('session-1', 90, 1_000);
    const entry = getRestTimerEntry();
    expect(entry).toEqual({
      sessionId: 'session-1',
      startedAtMs: 1_000,
      endsAtMs: 91_000,
      durationSec: 90,
    });

    // Different session sees idle.
    expect(deriveRestTimerView(entry, 'session-2', 10_000)).toEqual({ status: 'idle' });
    expect(deriveRestTimerView(entry, null, 10_000)).toEqual({ status: 'idle' });

    // Running view rounds remaining fractional seconds up.
    expect(deriveRestTimerView(entry, 'session-1', 31_200)).toEqual({
      status: 'running',
      sessionId: 'session-1',
      remainingSec: 60,
      formatted: '1:00',
      durationSec: 90,
    });

    // Completed view stops at 0:00 and never goes negative.
    expect(deriveRestTimerView(entry, 'session-1', 91_000)).toEqual({
      status: 'completed',
      sessionId: 'session-1',
      remainingSec: 0,
      formatted: '0:00',
      durationSec: 90,
    });
    expect(deriveRestTimerView(entry, 'session-1', 120_000)).toEqual({
      status: 'completed',
      sessionId: 'session-1',
      remainingSec: 0,
      formatted: '0:00',
      durationSec: 90,
    });
  });

  it('adjusts, restarts, and dismisses the timer for the matching session', () => {
    startRestTimer('session-1', 60, 0);

    // Ignore adjustments for a different session or non-finite delta.
    adjustRestTimer('session-2', REST_TIMER_STEP_SEC, 10_000);
    adjustRestTimer('session-1', Number.NaN, 10_000);
    expect(getRestTimerEntry()?.endsAtMs).toBe(60_000);

    // Add 15s while 50s remain -> 65s remain.
    adjustRestTimer('session-1', REST_TIMER_STEP_SEC, 10_000);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', 10_000)).toMatchObject({
      status: 'running',
      remainingSec: 65,
      formatted: '1:05',
    });

    // Subtract more than remaining clamps at 0:00 (completed).
    adjustRestTimer('session-1', -120, 10_000);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', 10_000)).toMatchObject({
      status: 'completed',
      remainingSec: 0,
      formatted: '0:00',
    });

    // Adding +15s from completed resumes running with 0:15 remaining.
    adjustRestTimer('session-1', REST_TIMER_STEP_SEC, 12_000);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', 12_000)).toMatchObject({
      status: 'running',
      remainingSec: 15,
      formatted: '0:15',
    });

    // Restart resets to the entry's duration when no override is passed.
    restartRestTimer('session-1', undefined, 20_000);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', 20_000)).toMatchObject({
      status: 'running',
      remainingSec: 60,
      formatted: '1:00',
    });

    // Dismissing a different session leaves session-1 intact.
    dismissRestTimer('session-2');
    expect(getRestTimerEntry()).not.toBeNull();

    dismissRestTimer('session-1');
    expect(getRestTimerEntry()).toBeNull();
  });

  it('drives useSessionRestTimer across ticks, manual toggle, auto-start, and completed-session suppression', () => {
    jest.useFakeTimers();
    let nowMs = 1_000;
    const now = () => nowMs;

    const { result, rerender } = renderHook(
      ({
        isActiveSession,
        autoStart,
        defaultDurationSec,
      }: {
        isActiveSession: boolean;
        autoStart: boolean;
        defaultDurationSec: number;
      }) =>
        useSessionRestTimer('session-1', {
          defaultDurationSec,
          autoStart,
          isActiveSession,
          now,
        }),
      {
        initialProps: {
          isActiveSession: true,
          autoStart: true,
          defaultDurationSec: 45,
        },
      },
    );

    expect(result.current.view).toEqual({ status: 'idle' });
    expect(result.current.isActive).toBe(false);

    // Auto-start on set confirmed.
    act(() => {
      result.current.onSetConfirmed();
    });
    expect(result.current.view).toMatchObject({
      status: 'running',
      remainingSec: 45,
      formatted: '0:45',
    });

    // Advance clock to expiration and tick interval.
    act(() => {
      nowMs = 46_000;
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.view).toMatchObject({
      status: 'completed',
      remainingSec: 0,
      formatted: '0:00',
    });

    // Adjust +15s from hook.
    act(() => {
      result.current.adjust(15);
    });
    expect(result.current.view).toMatchObject({
      status: 'running',
      remainingSec: 15,
      formatted: '0:15',
    });

    // Toggle when active dismisses the timer.
    act(() => {
      result.current.toggle();
    });
    expect(result.current.view).toEqual({ status: 'idle' });

    // With autoStart = false, onSetConfirmed does nothing, but manual toggle still starts.
    rerender({ isActiveSession: true, autoStart: false, defaultDurationSec: 75 });
    act(() => {
      result.current.onSetConfirmed();
    });
    expect(result.current.view).toEqual({ status: 'idle' });

    act(() => {
      result.current.toggle();
    });
    expect(result.current.view).toMatchObject({
      status: 'running',
      remainingSec: 75,
      formatted: '1:15',
    });

    // Completed session edit suppresses the view and toggleForSession.
    rerender({ isActiveSession: false, autoStart: true, defaultDurationSec: 75 });
    expect(result.current.view).toEqual({ status: 'idle' });
    expect(result.current.toggleForSession).toBeUndefined();
  });
});
