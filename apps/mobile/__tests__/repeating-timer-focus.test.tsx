import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Vibration } from 'react-native';
import { Circle } from 'react-native-svg';

import { RestTimerBar } from '@/components/session-recorder/rest-timer-bar';
import { uiRoles } from '@/components/ui/tokens';
import {
  __resetRestTimerForTests, adjustRepeatingTimer, getRestTimerEntry, startRepeatingTimer,
  stopRepeatingTimer, useSessionRestTimer,
} from '@/src/session-recorder/rest-timer';

function TimerHost() {
  const timer = useSessionRestTimer('session-1');
  return <RestTimerBar view={timer.view} onAdjust={timer.adjust} onDismiss={timer.dismiss} onRestart={timer.restart} onResetRepeating={timer.resetRepeating} onToggleRepeating={timer.toggleRepeating} onSwitchMode={timer.switchMode} />;
}

const expand = () => fireEvent.press(screen.getByTestId('repeating-timer-expand'));
const advance = (ms: number) => act(() => jest.advanceTimersByTime(ms));
const expectProgress = (remaining: number) => {
  const ring = screen.UNSAFE_getAllByType(Circle).find((circle) => circle.props.testID === 'repeating-timer-focus-progress')!;
  expect(ring.props.stroke).toBe(uiRoles.accent);
  expect(ring.props.strokeDashoffset).toBeCloseTo(ring.props.strokeDasharray[0] * (1 - remaining));
};

beforeEach(() => {
  __resetRestTimerForTests();
  jest.useFakeTimers({ now: 0 });
});

afterEach(() => {
  __resetRestTimerForTests();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('uses the live store through preparation, rollover, pause/resume, reset and collapse/reopen', () => {
  const cue = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
  startRepeatingTimer('session-1', 60);
  render(<TimerHost />);
  expand();
  expect(screen.getByTestId('repeating-timer-focus-round')).toHaveTextContent('Get ready');
  expect(screen.getByTestId('repeating-timer-focus-countdown')).toHaveTextContent('0:15');
  expect(screen.getByTestId('repeating-timer-focus-toggle').props.accessibilityLabel).toBe('Pause repeating timer');
  const meter = screen.getByTestId('repeating-timer-focus-meter');
  expect(meter.findAll((node) => node.props.testID === 'repeating-timer-focus-round')).toHaveLength(0);
  expect(meter.findAll((node) => node.props.testID === 'repeating-timer-focus-toggle')).toHaveLength(0);
  expect(meter.findAll((node) => node.props.testID === 'repeating-timer-focus-reset')).toHaveLength(0);
  expectProgress(1);
  advance(5_000);
  expectProgress(10 / 15);
  advance(10_000);
  expect(screen.getByTestId('repeating-timer-focus-round')).toHaveTextContent('Round 1');
  expectProgress(1);
  expect(cue).toHaveBeenCalledTimes(1);
  advance(18_500);
  fireEvent.press(screen.getByTestId('repeating-timer-focus-toggle'));
  const paused = getRestTimerEntry();
  expect(paused).toMatchObject({ accumulatedMs: 33_500, pausedAtMs: 33_500 });
  expect(screen.getByTestId('repeating-timer-focus-toggle')).toHaveTextContent('Resume');
  expect(screen.getByTestId('repeating-timer-focus-toggle').props.accessibilityLabel).toBe('Resume repeating timer');
  expect(screen.getByTestId('repeating-timer-focus-countdown')).toHaveTextContent('0:42');
  expectProgress(42 / 60);
  fireEvent.press(screen.getByTestId('repeating-timer-focus-close'));
  expect(screen.queryByTestId('repeating-timer-focus')).toBeNull();
  advance(10_000);
  expand();
  expect(getRestTimerEntry()).toBe(paused);
  expectProgress(42 / 60);
  fireEvent.press(screen.getByTestId('repeating-timer-focus-toggle'));
  advance(1_500);
  expect(screen.getByTestId('repeating-timer-focus-countdown')).toHaveTextContent('0:40');
  fireEvent.press(screen.getByTestId('repeating-timer-focus-reset'));
  expect(screen.getByTestId('repeating-timer-focus-round')).toHaveTextContent('Get ready');
  expect(getRestTimerEntry()).toMatchObject({ accumulatedMs: 0, pausedAtMs: null });
  fireEvent.press(screen.getByTestId('repeating-timer-focus-close'));
  advance(30_000);
  expand();
  expect(screen.getByTestId('repeating-timer-focus-countdown')).toHaveTextContent('0:45');
  expect(cue).toHaveBeenCalledTimes(2);
});

it.each([false, true])('adjusts within bounds and resets to preparation, preserving paused=%s', (paused) => {
  startRepeatingTimer('session-1', 15);
  if (paused) stopRepeatingTimer('session-1');
  render(<TimerHost />);
  expand();
  expect(screen.getByTestId('repeating-timer-focus-minus')).toBeDisabled();
  fireEvent.press(screen.getByTestId('repeating-timer-focus-minus'));
  expect(getRestTimerEntry()).toMatchObject({ intervalSec: 15 });
  fireEvent.press(screen.getByTestId('repeating-timer-focus-plus'));
  expect(screen.getByTestId('repeating-timer-focus-interval')).toHaveTextContent('0:30');
  expect(screen.getByTestId('repeating-timer-focus-minus')).toBeEnabled();
  expect(screen.getByTestId('repeating-timer-focus-round')).toHaveTextContent(paused ? 'Get ready · Paused' : 'Get ready');
  fireEvent.press(screen.getByTestId('repeating-timer-focus-reset'));
  expect(getRestTimerEntry()).toMatchObject({ accumulatedMs: 0, pausedAtMs: paused ? 0 : null });
  act(() => adjustRepeatingTimer('session-1', 570));
  expect(screen.getByTestId('repeating-timer-focus-interval')).toHaveTextContent('10:00');
  expect(screen.getByTestId('repeating-timer-focus-plus')).toBeDisabled();
  fireEvent.press(screen.getByTestId('repeating-timer-focus-plus'));
  expect(getRestTimerEntry()).toMatchObject({ intervalSec: 600 });
  fireEvent.press(screen.getByTestId('repeating-timer-focus-minus'));
  expect(screen.getByTestId('repeating-timer-focus-interval')).toHaveTextContent('9:45');
});

it('updates the persistent accessibility readout when phase/pause change at the same visible countdown', () => {
  startRepeatingTimer('session-1', 15);
  render(<TimerHost />);
  expand();
  advance(3_000);
  const readout = screen.getByTestId('repeating-timer-focus-readout');
  const compact = screen.getByTestId('repeating-timer-readout');
  expect(readout.props.accessibilityLabel).toBe('Get ready, 0:12 remaining');
  expect(compact.props.accessibilityLabel).toBe('Repeating timer preparation, 0:12 remaining');
  advance(15_000);
  fireEvent.press(screen.getByTestId('repeating-timer-focus-toggle'));
  expect(screen.getByTestId('repeating-timer-focus-countdown')).toHaveTextContent('0:12');
  expect(screen.getByTestId('repeating-timer-focus-readout')).toBe(readout);
  expect(readout.props).toMatchObject({ accessible: true, accessibilityLabel: 'Round 1, 0:12 remaining, paused', accessibilityLiveRegion: 'none' });
  expect(compact.props.accessibilityLabel).toBe('Repeating timer round 1, 0:12 remaining, paused');
  expect(screen.getByTestId('repeating-timer-focus-countdown').props.accessible).toBe(false);
  expect(screen.getByTestId('repeating-timer-countdown').props.accessible).toBe(false);
  fireEvent.press(screen.getByTestId('repeating-timer-focus-toggle'));
  expect(readout.props.accessibilityLabel).toBe('Round 1, 0:12 remaining');
});

it.each(['requestClose', 'accessibilityEscape'] as const)('%s collapses without dismissing or pausing', (event) => {
  startRepeatingTimer('session-1', 60);
  render(<TimerHost />);
  expand();
  const entry = getRestTimerEntry();
  fireEvent(screen.getByTestId(event === 'requestClose' ? 'repeating-timer-focus-modal' : 'repeating-timer-focus'), event);
  expect(screen.queryByTestId('repeating-timer-focus')).toBeNull();
  expect(getRestTimerEntry()).toBe(entry);
  advance(20_000);
  expand();
  expect(screen.getByTestId('repeating-timer-focus-countdown')).toHaveTextContent('0:55');
});

it('fits long figures, keeps rounds open-ended, and never announces countdown ticks', () => {
  startRepeatingTimer('session-1', 600, -(999 * 600 + 15) * 1000);
  render(<TimerHost />);
  expand();
  expect(screen.getByTestId('repeating-timer-focus-round')).toHaveTextContent('Round 1000');
  const countdown = screen.getByTestId('repeating-timer-focus-countdown');
  expect(countdown).toHaveTextContent('10:00');
  expect(countdown.props).toMatchObject({ adjustsFontSizeToFit: true, numberOfLines: 1, accessibilityLiveRegion: 'none' });
  fireEvent.press(screen.getByTestId('repeating-timer-focus-close'));
  expect(screen.getByTestId('repeating-timer-countdown').props.accessibilityLiveRegion).toBe('none');
  fireEvent.press(screen.getByTestId('timer-mode-selector-rest'));
  expect(screen.queryByTestId('repeating-timer-expand')).toBeNull();
  fireEvent.press(screen.getByTestId('timer-mode-selector-repeating'));
  expect(screen.queryByTestId('repeating-timer-focus')).toBeNull();
  fireEvent.press(screen.getByTestId('rest-timer-dismiss'));
  expect(screen.queryByTestId('rest-timer-bar')).toBeNull();
});
