import { act, renderHook } from '@testing-library/react-native';
import { Vibration } from 'react-native';

import {
  __resetRestTimerForTests,
  adjustRepeatingTimer,
  adjustRestTimer,
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
  triggerRoundBoundaryCue,
  useSessionRestTimer,
} from '@/src/session-recorder/rest-timer';

describe('rest-timer store and pure rules', () => {
  beforeEach(() => {
    __resetRestTimerForTests();
    jest.useRealTimers();
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

  it('derives repeating timer views with zero cumulative drift across rounds and intervals', () => {
    // 60-second interval (standard EMOM)
    startRepeatingTimer('session-1', 60, 10_000);
    const entry = getRestTimerEntry();
    expect(entry).toEqual({
      mode: 'repeating',
      sessionId: 'session-1',
      startedAtMs: 10_000,
      accumulatedMs: 0,
      pausedAtMs: null,
      intervalSec: 60,
    });

    // At start (t=0): Round 1, 60s remaining
    expect(deriveRestTimerView(entry, 'session-1', 10_000)).toEqual({
      mode: 'repeating',
      status: 'running',
      sessionId: 'session-1',
      round: 1,
      remainingSec: 60,
      formatted: '1:00',
      intervalSec: 60,
      isPaused: false,
    });

    // 15 seconds into round 1: Round 1, 45s remaining
    expect(deriveRestTimerView(entry, 'session-1', 25_000)).toMatchObject({
      round: 1,
      remainingSec: 45,
      formatted: '0:45',
    });

    // 59 seconds into round 1: Round 1, 1s remaining
    expect(deriveRestTimerView(entry, 'session-1', 69_000)).toMatchObject({
      round: 1,
      remainingSec: 1,
      formatted: '0:01',
    });

    // Exactly at 60s boundary: Round 2 begins immediately with 60s remaining
    expect(deriveRestTimerView(entry, 'session-1', 70_000)).toMatchObject({
      round: 2,
      remainingSec: 60,
      formatted: '1:00',
    });

    // Round 2 at 30s in: Round 2, 30s remaining
    expect(deriveRestTimerView(entry, 'session-1', 100_000)).toMatchObject({
      round: 2,
      remainingSec: 30,
      formatted: '0:30',
    });

    // After 10 full rounds (600 seconds elapsed): Round 11 begins at 60s remaining with zero drift
    expect(deriveRestTimerView(entry, 'session-1', 610_000)).toMatchObject({
      round: 11,
      remainingSec: 60,
      formatted: '1:00',
    });

    // 45-second interval
    const entry45 = {
      mode: 'repeating' as const,
      sessionId: 'session-1',
      startedAtMs: 0,
      accumulatedMs: 0,
      pausedAtMs: null,
      intervalSec: 45,
    };
    expect(deriveRepeatingTimerView(entry45, 'session-1', 0)).toMatchObject({
      round: 1,
      remainingSec: 45,
      formatted: '0:45',
    });
    expect(deriveRepeatingTimerView(entry45, 'session-1', 44_000)).toMatchObject({
      round: 1,
      remainingSec: 1,
      formatted: '0:01',
    });
    expect(deriveRepeatingTimerView(entry45, 'session-1', 45_000)).toMatchObject({
      round: 2,
      remainingSec: 45,
      formatted: '0:45',
    });
  });

  it('freezes countdown when paused and resumes with zero drift', () => {
    startRepeatingTimer('session-1', 60, 0);

    // Run for 20 seconds, then pause
    stopRepeatingTimer('session-1', 20_000);
    const pausedEntry = getRestTimerEntry();
    expect(pausedEntry).toMatchObject({
      mode: 'repeating',
      accumulatedMs: 20_000,
      pausedAtMs: 20_000,
    });

    // Time advances 10 minutes while paused: view remains frozen at Round 1, 40s remaining
    expect(deriveRestTimerView(pausedEntry, 'session-1', 620_000)).toMatchObject({
      status: 'paused',
      round: 1,
      remainingSec: 40,
      formatted: '0:40',
      isPaused: true,
    });

    // Resume at t = 620_000ms
    startRepeatingTimer('session-1', 60, 620_000);
    const resumedEntry = getRestTimerEntry();
    expect(resumedEntry).toMatchObject({
      mode: 'repeating',
      startedAtMs: 620_000,
      accumulatedMs: 20_000,
      pausedAtMs: null,
    });

    // 10 seconds later (total elapsed 30s): Round 1, 30s remaining
    expect(deriveRestTimerView(resumedEntry, 'session-1', 630_000)).toMatchObject({
      status: 'running',
      round: 1,
      remainingSec: 30,
      formatted: '0:30',
      isPaused: false,
    });

    // Another 30 seconds later (total elapsed 60s): Round 2 begins
    expect(deriveRestTimerView(resumedEntry, 'session-1', 660_000)).toMatchObject({
      status: 'running',
      round: 2,
      remainingSec: 60,
      formatted: '1:00',
    });
  });

  it('supports toggle, reset, and interval adjustments for repeating timer', () => {
    startRepeatingTimer('session-1', 60, 0);

    // Toggle while running -> pauses
    toggleRepeatingTimer('session-1', 15_000);
    expect(getRestTimerEntry()).toMatchObject({ pausedAtMs: 15_000, accumulatedMs: 15_000 });

    // Toggle while paused -> resumes
    toggleRepeatingTimer('session-1', 25_000);
    expect(getRestTimerEntry()).toMatchObject({ pausedAtMs: null, startedAtMs: 25_000, accumulatedMs: 15_000 });

    // Reset resets to round 1 with 0 accumulated time
    resetRepeatingTimer('session-1', 30_000);
    expect(getRestTimerEntry()).toMatchObject({
      startedAtMs: 30_000,
      accumulatedMs: 0,
      pausedAtMs: null,
      intervalSec: 60,
    });
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', 30_000)).toMatchObject({
      round: 1,
      remainingSec: 60,
      formatted: '1:00',
    });

    // Adjust interval: +15s -> 75s
    adjustRepeatingTimer('session-1', REPEATING_TIMER_STEP_SEC, 35_000);
    expect(getRestTimerEntry()).toMatchObject({ intervalSec: 75 });
    expect(deriveRestTimerView(getRestTimerEntry(), 'session-1', 35_000)).toMatchObject({
      round: 1,
      remainingSec: 75,
      formatted: '1:15',
    });

    // Adjust interval clamps to [15, 600]
    adjustRepeatingTimer('session-1', -100, 40_000);
    expect(getRestTimerEntry()).toMatchObject({ intervalSec: 15 });
    adjustRepeatingTimer('session-1', 1_000, 45_000);
    expect(getRestTimerEntry()).toMatchObject({ intervalSec: 600 });
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

  it('isolates set logging from repeating mode: onSetConfirmed neither restarts nor interrupts repeating timer', () => {
    jest.useFakeTimers();
    let nowMs = 1_000;
    const now = () => nowMs;

    const { result } = renderHook(() =>
      useSessionRestTimer('session-1', {
        defaultDurationSec: 90,
        defaultRepeatingIntervalSec: 60,
        autoStart: true,
        isActiveSession: true,
        now,
      }),
    );

    // Start repeating timer and advance 25 seconds
    act(() => {
      result.current.switchMode('repeating');
    });
    expect(result.current.view).toMatchObject({
      mode: 'repeating',
      round: 1,
      remainingSec: 60,
      formatted: '1:00',
    });

    act(() => {
      nowMs = 26_000;
      jest.advanceTimersByTime(1000);
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
      nowMs = 61_000;
      jest.advanceTimersByTime(1000);
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
