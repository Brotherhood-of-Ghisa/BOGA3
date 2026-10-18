import { act, renderHook } from '@testing-library/react-native';
import { Vibration } from 'react-native';

import {
  __resetRestTimerForTests,
  adjustRepeatingTimer,
  adjustRestTimer,
  checkAndTriggerRestCompletion,
  checkAndTriggerRoundBoundary,
  deriveRepeatingTimerView,
  deriveRestTimerView,
  dismissRestTimer,
  formatRestTimerSeconds,
  getRestTimerEntry,
  REPEATING_TIMER_STEP_SEC,
  REST_TIMER_STEP_SEC,
  resetRepeatingTimer,
  restartRestTimer,
  startRepeatingTimer,
  startRestTimer,
  stopRepeatingTimer,
  switchTimerMode,
  toggleRepeatingTimer,
  triggerRestCompletionCue,
  triggerRoundBoundaryCue,
  useSessionRestTimer,
} from '@/src/session-recorder/rest-timer';

describe('rest-timer store and pure rules', () => {
  beforeEach(() => {
    __resetRestTimerForTests();
    jest.useFakeTimers({ now: 0 });
    jest.clearAllMocks();
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
      mode: 'rest',
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
      mode: 'rest',
      status: 'running',
      sessionId: 'session-1',
      remainingSec: 60,
      formatted: '1:00',
      durationSec: 90,
    });

    // Completed view stops at 0:00 and never goes negative.
    expect(deriveRestTimerView(entry, 'session-1', 91_000)).toEqual({
      mode: 'rest',
      status: 'completed',
      sessionId: 'session-1',
      remainingSec: 0,
      formatted: '0:00',
      durationSec: 90,
    });
    expect(deriveRestTimerView(entry, 'session-1', 120_000)).toEqual({
      mode: 'rest',
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
    expect(getRestTimerEntry()).toMatchObject({ endsAtMs: 60_000 });

    // Add 15s while 50s remain -> 65s remain.
    adjustRestTimer('session-1', REST_TIMER_STEP_SEC, 10_000);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', 10_000)).toMatchObject({
      mode: 'rest',
      status: 'running',
      remainingSec: 65,
      formatted: '1:05',
    });

    // Subtract more than remaining clamps at 0:00 (completed).
    adjustRestTimer('session-1', -120, 10_000);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', 10_000)).toMatchObject({
      mode: 'rest',
      status: 'completed',
      remainingSec: 0,
      formatted: '0:00',
    });

    // Adding +15s from completed resumes running with 0:15 remaining.
    adjustRestTimer('session-1', REST_TIMER_STEP_SEC, 12_000);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', 12_000)).toMatchObject({
      mode: 'rest',
      status: 'running',
      remainingSec: 15,
      formatted: '0:15',
    });

    // Restart resets to the entry's duration when no override is passed.
    restartRestTimer('session-1', undefined, 20_000);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', 20_000)).toMatchObject({
      mode: 'rest',
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

  it('keeps preparation outside drift-free round and interval calculations', () => {
    startRepeatingTimer('session-1', 60, 10_000);
    const entry = getRestTimerEntry();
    expect(entry).toEqual({
      mode: 'repeating', sessionId: 'session-1', startedAtMs: 10_000,
      accumulatedMs: 0, pausedAtMs: null, intervalSec: 60,
    });
    expect(deriveRestTimerView(entry, 'session-1', 10_000)).toEqual({
      mode: 'repeating', status: 'preparing', sessionId: 'session-1',
      round: 0, remainingSec: 15, formatted: '0:15', intervalSec: 60, isPaused: false,
    });
    expect(deriveRestTimerView(entry, 'session-1', 24_999)).toMatchObject({
      status: 'preparing', round: 0, remainingSec: 1,
    });
    for (const [nowMs, round, remainingSec] of [
      [25_000, 1, 60], [40_000, 1, 45], [84_000, 1, 1],
      [85_000, 2, 60], [115_000, 2, 30], [625_000, 11, 60],
    ]) {
      expect(deriveRestTimerView(entry, 'session-1', nowMs)).toMatchObject({
        status: 'running', round, remainingSec,
      });
    }
    const entry45 = {
      mode: 'repeating' as const, sessionId: 'session-1', startedAtMs: 0,
      accumulatedMs: 0, pausedAtMs: null, intervalSec: 45,
    };
    for (const [nowMs, round, remainingSec] of [[15_000, 1, 45], [59_000, 1, 1], [60_000, 2, 45]]) {
      expect(deriveRepeatingTimerView(entry45, 'session-1', nowMs)).toMatchObject({ round, remainingSec });
    }
  });

  it.each([5_000, 35_000])('retains preparation or round position when paused at %i ms', (pauseAtMs) => {
    startRepeatingTimer('session-1', 60, 0);
    const beforePause = deriveRestTimerView(getRestTimerEntry(), 'session-1', pauseAtMs);
    stopRepeatingTimer('session-1', pauseAtMs);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', pauseAtMs + 600_000)).toEqual({
      ...beforePause, status: 'paused', isPaused: true,
    });
    startRepeatingTimer('session-1', 60, pauseAtMs + 600_000);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', pauseAtMs + 600_000)).toEqual(beforePause);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', 675_000)).toMatchObject({
      status: 'running', round: 2, remainingSec: 60,
    });
  });

  it('supports toggle, reset, and interval adjustments for repeating timer', () => {
    startRepeatingTimer('session-1', 60, 0);
    toggleRepeatingTimer('session-1', 15_000);
    expect(getRestTimerEntry()).toMatchObject({ pausedAtMs: 15_000, accumulatedMs: 15_000 });
    toggleRepeatingTimer('session-1', 25_000);
    expect(getRestTimerEntry()).toMatchObject({ pausedAtMs: null, startedAtMs: 25_000, accumulatedMs: 15_000 });

    resetRepeatingTimer('session-1', 30_000);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', 30_000)).toMatchObject({
      status: 'preparing', round: 0, remainingSec: 15,
    });
    adjustRepeatingTimer('session-1', REPEATING_TIMER_STEP_SEC, 35_000);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', 50_000)).toMatchObject({
      round: 1, remainingSec: 75, formatted: '1:15',
    });
    adjustRepeatingTimer('session-1', -100, 40_000);
    expect(getRestTimerEntry()).toMatchObject({ intervalSec: 15 });
    adjustRepeatingTimer('session-1', 1_000, 45_000);
    expect(getRestTimerEntry()).toMatchObject({ intervalSec: 600 });

    stopRepeatingTimer('session-1', 50_000);
    resetRepeatingTimer('session-1', 55_000);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', 100_000)).toMatchObject({
      status: 'paused', round: 0, remainingSec: 15,
    });
  });

  it.each([[15, -15], [600, 15]])('preserves progress at the %i-second interval limit', (intervalSec, deltaSec) => {
    startRepeatingTimer('session-1', intervalSec, 0);
    const nowMs = 15_000 + intervalSec * 3_000 + 2_000;
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', nowMs)).toMatchObject({
      round: 4, remainingSec: intervalSec - 2,
    });
    const runningEntry = getRestTimerEntry();
    adjustRepeatingTimer('session-1', deltaSec, nowMs);
    expect(getRestTimerEntry()).toBe(runningEntry);
    stopRepeatingTimer('session-1', nowMs);
    const pausedEntry = getRestTimerEntry();
    adjustRepeatingTimer('session-1', deltaSec, nowMs + 1_000);
    expect(getRestTimerEntry()).toBe(pausedEntry);
  });

  it('owns one cue clock across multiple views and after all views unmount', () => {
    const first = renderHook(() => useSessionRestTimer('session-1'));
    const second = renderHook(() => useSessionRestTimer('session-1'));
    act(() => first.result.current.switchMode('repeating'));
    act(() => jest.advanceTimersByTime(14_999));
    expect(Vibration.vibrate).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(first.result.current.view).toMatchObject({ status: 'running', round: 1, remainingSec: 60 });
    expect(second.result.current.view).toMatchObject({ round: 1 });
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    first.unmount();
    second.unmount();
    jest.advanceTimersByTime(60_000);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(2);
    expect(Vibration.vibrate).toHaveBeenLastCalledWith(400);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1')).toMatchObject({ round: 2 });
  });

  it('stops cues while paused and resumes on the exact boundary', () => {
    startRepeatingTimer('session-1');
    jest.advanceTimersByTime(5_125);
    stopRepeatingTimer('session-1');
    jest.advanceTimersByTime(60_000);
    expect(Vibration.vibrate).not.toHaveBeenCalled();
    startRepeatingTimer('session-1');
    jest.advanceTimersByTime(9_874);
    expect(Vibration.vibrate).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(20_123);
    stopRepeatingTimer('session-1');
    jest.advanceTimersByTime(120_000);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    startRepeatingTimer('session-1');
    jest.advanceTimersByTime(39_877);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(2);
  });

  it.each(['dismiss', 'switch', 'replace'] as const)('cancels repeating cues on %s', (action) => {
    startRepeatingTimer('session-1');
    if (action === 'dismiss') dismissRestTimer('session-1');
    if (action === 'switch') switchTimerMode('session-1', 'rest');
    if (action === 'replace') startRepeatingTimer('session-2');
    jest.advanceTimersByTime(15_000);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(action === 'replace' ? 1 : 0);
    dismissRestTimer();
    jest.advanceTimersByTime(120_000);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(action === 'replace' ? 1 : 0);
  });

  it('signals once after a delayed callback skips rounds, then realigns to the wall clock', () => {
    startRepeatingTimer('session-1');
    jest.setSystemTime(190_000);
    jest.advanceTimersByTime(15_000);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1')).toMatchObject({ round: 4, remainingSec: 50 });
    jest.advanceTimersByTime(49_999);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(2);
  });

  it('switches timer modes smoothly between rest and repeating', () => {
    startRestTimer('session-1', 90, 0);
    expect(getRestTimerEntry()?.mode).toBe('rest');

    // Switch to repeating: starts repeating timer with specified or default interval
    switchTimerMode('session-1', 'repeating', { repeatingIntervalSec: 45, nowMs: 5_000 });
    expect(getRestTimerEntry()).toMatchObject({
      mode: 'repeating',
      intervalSec: 45,
      startedAtMs: 5_000,
      accumulatedMs: 0,
    });

    // Re-switching to repeating is a no-op
    switchTimerMode('session-1', 'repeating', { repeatingIntervalSec: 60, nowMs: 10_000 });
    expect(getRestTimerEntry()).toMatchObject({ intervalSec: 45 });

    // Switch to rest: starts rest timer with specified duration
    switchTimerMode('session-1', 'rest', { restDurationSec: 120, nowMs: 15_000 });
    expect(getRestTimerEntry()).toMatchObject({
      mode: 'rest',
      durationSec: 120,
      startedAtMs: 15_000,
      endsAtMs: 135_000,
    });
  });

  it('triggers haptic cue at round boundaries via Vibration.vibrate(400)', () => {
    // Initial start at round 1 does NOT vibrate
    checkAndTriggerRoundBoundary(1);
    expect(Vibration.vibrate).not.toHaveBeenCalled();

    // Crossing boundary to round 2 triggers vibration
    checkAndTriggerRoundBoundary(2);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    expect(Vibration.vibrate).toHaveBeenCalledWith(400);

    // Remaining within round 2 does not repeat vibration
    checkAndTriggerRoundBoundary(2);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);

    // Clock jump (suspension across multiple rounds to round 5) vibrates once
    checkAndTriggerRoundBoundary(5);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(2);

    // Resetting and starting fresh round 1
    __resetRestTimerForTests();
    checkAndTriggerRoundBoundary(1);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(2);
    checkAndTriggerRoundBoundary(2);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(3);

    // triggerRoundBoundaryCue handles exceptions gracefully
    jest.mocked(Vibration.vibrate).mockImplementationOnce(() => {
      throw new Error('Native vibration unavailable');
    });
    expect(() => triggerRoundBoundaryCue()).not.toThrow();
  });

  it('triggers vibration cue when rest timer countdown reaches 0 and deduplicates', () => {
    startRestTimer('session-1', 90, 0);
    expect(Vibration.vibrate).not.toHaveBeenCalled();

    jest.advanceTimersByTime(89_999);
    expect(Vibration.vibrate).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    expect(Vibration.vibrate).toHaveBeenCalledWith(400);

    // Remaining in completed status does not re-trigger vibration
    jest.advanceTimersByTime(10_000);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
  });

  it('reschedules rest timer completion cue when adjusted', () => {
    startRestTimer('session-1', 60, 0);

    // Advance 30s, then add 15s (new target is 75s)
    jest.advanceTimersByTime(30_000);
    adjustRestTimer('session-1', 15, 30_000);

    jest.advanceTimersByTime(30_000); // at 60s total
    expect(Vibration.vibrate).not.toHaveBeenCalled();

    jest.advanceTimersByTime(15_000); // at 75s total
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    expect(Vibration.vibrate).toHaveBeenCalledWith(400);
  });

  it.each(['dismiss', 'replace'] as const)('cancels rest timer completion cues on %s', (action) => {
    startRestTimer('session-1', 30, 0);
    if (action === 'dismiss') dismissRestTimer('session-1');
    if (action === 'replace') startRestTimer('session-2', 60, 0);

    jest.advanceTimersByTime(30_000);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(0);

    if (action === 'replace') {
      jest.advanceTimersByTime(30_000); // at 60s total for session-2
      expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    }
  });

  it('cancels rest timer completion cue when switching to repeating mode', () => {
    startRestTimer('session-1', 30, 0);
    switchTimerMode('session-1', 'repeating');
    // Repeating timer signals round 1 after 15s preparation
    jest.advanceTimersByTime(15_000);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);

    // At 30s (when original rest timer would have completed), no second cue fires
    jest.advanceTimersByTime(15_000);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
  });

  it('triggers rest completion cue even after screen hook unmounts', () => {
    const hook = renderHook(() => useSessionRestTimer('session-1'));
    act(() => {
      hook.result.current.start();
    });
    hook.unmount();

    jest.advanceTimersByTime(90_000);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    expect(Vibration.vibrate).toHaveBeenCalledWith(400);
  });

  it('handles vibration errors gracefully in triggerRestCompletionCue', () => {
    jest.mocked(Vibration.vibrate).mockImplementationOnce(() => {
      throw new Error('Native vibration error');
    });
    expect(() => triggerRestCompletionCue()).not.toThrow();
  });

  it('isolates set logging from repeating mode: onSetConfirmed neither restarts nor interrupts repeating timer', () => {
    jest.setSystemTime(1_000);
    const now = () => Date.now();

    const { result } = renderHook(() =>
      useSessionRestTimer('session-1', {
        defaultDurationSec: 90,
        defaultRepeatingIntervalSec: 60,
        autoStart: true,
        isActiveSession: true,
        now,
      }),
    );

    // Prepare, then advance 25 seconds into round 1
    act(() => {
      result.current.switchMode('repeating');
    });
    expect(result.current.view).toMatchObject({
      mode: 'repeating',
      status: 'preparing',
      round: 0,
      remainingSec: 15,
      formatted: '0:15',
    });

    act(() => {
      jest.advanceTimersByTime(40_000);
    });
    expect(result.current.view).toMatchObject({
      mode: 'repeating',
      round: 1,
      remainingSec: 35,
      formatted: '0:35',
    });

    // Confirming a set MUST NOT restart or interrupt the repeating timer!
    act(() => {
      result.current.onSetConfirmed();
    });
    expect(result.current.view).toMatchObject({
      mode: 'repeating',
      round: 1,
      remainingSec: 35,
      formatted: '0:35',
    });

    // Advance clock past round boundary -> Round 2 starts automatically and triggers cue
    act(() => {
      jest.advanceTimersByTime(35_000);
    });
    expect(result.current.view).toMatchObject({
      mode: 'repeating',
      round: 2,
      remainingSec: 60,
      formatted: '1:00',
    });
    expect(Vibration.vibrate).toHaveBeenCalledWith(400);

    // Pausing works via toggleRepeating
    act(() => {
      result.current.toggleRepeating();
    });
    expect(result.current.view).toMatchObject({
      mode: 'repeating',
      status: 'paused',
      isPaused: true,
    });

    // Resuming works via toggleRepeating
    act(() => {
      result.current.toggleRepeating();
    });
    expect(result.current.view).toMatchObject({
      mode: 'repeating',
      status: 'running',
      isPaused: false,
    });

    // Switching back to rest mode allows onSetConfirmed to auto-start rest timer again
    act(() => {
      result.current.switchMode('rest');
    });
    expect(result.current.view).toMatchObject({
      mode: 'rest',
      status: 'running',
      remainingSec: 90,
    });

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.view).toEqual({ status: 'idle' });

    act(() => {
      result.current.onSetConfirmed();
    });
    expect(result.current.view).toMatchObject({
      mode: 'rest',
      status: 'running',
      remainingSec: 90,
    });
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
      mode: 'rest',
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
      mode: 'rest',
      status: 'completed',
      remainingSec: 0,
      formatted: '0:00',
    });

    // Adjust +15s from hook.
    act(() => {
      result.current.adjust(15);
    });
    expect(result.current.view).toMatchObject({
      mode: 'rest',
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
      mode: 'rest',
      status: 'running',
      remainingSec: 75,
      formatted: '1:15',
    });

    // Completed session edit suppresses the view and toggleForSession.
    rerender({ isActiveSession: false, autoStart: true, defaultDurationSec: 75 });
    expect(result.current.view).toEqual({ status: 'idle' });
    expect(result.current.toggleForSession).toBeUndefined();
  });

  it('updates view to completed when restarting and clock advances past expiry before first interval callback', () => {
    jest.useFakeTimers();
    let nowMs = 0;
    const now = () => nowMs;

    const { result } = renderHook(() =>
      useSessionRestTimer('session-1', {
        defaultDurationSec: 90,
        autoStart: true,
        isActiveSession: true,
        now,
      }),
    );

    act(() => {
      result.current.start();
    });
    expect(result.current.view).toMatchObject({ mode: 'rest', status: 'running', remainingSec: 90 });

    act(() => {
      nowMs = 90_000;
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.view).toMatchObject({ mode: 'rest', status: 'completed', remainingSec: 0 });

    act(() => {
      result.current.restart();
    });
    expect(result.current.view).toMatchObject({ mode: 'rest', status: 'running', remainingSec: 90 });

    act(() => {
      nowMs = 180_000;
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.view).toMatchObject({ mode: 'rest', status: 'completed', remainingSec: 0 });
  });

  it('renders first tick when replacing timer at 89 seconds', () => {
    jest.useFakeTimers();
    let nowMs = 0;
    const now = () => nowMs;

    const { result } = renderHook(() =>
      useSessionRestTimer('session-1', {
        defaultDurationSec: 90,
        autoStart: true,
        isActiveSession: true,
        now,
      }),
    );

    act(() => {
      result.current.start();
    });
    expect(result.current.view).toMatchObject({ mode: 'rest', status: 'running', remainingSec: 90 });

    act(() => {
      nowMs = 1_000;
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.view).toMatchObject({ mode: 'rest', status: 'running', remainingSec: 89 });

    act(() => {
      result.current.onSetConfirmed();
    });
    expect(result.current.view).toMatchObject({ mode: 'rest', status: 'running', remainingSec: 90 });

    act(() => {
      nowMs = 2_000;
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.view).toMatchObject({ mode: 'rest', status: 'running', remainingSec: 89 });
  });
});
