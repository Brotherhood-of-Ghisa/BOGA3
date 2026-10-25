import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { TitleBarTimer, describeTitleBarTimer, useTitleBarTimer } from '@/components/session-recorder/title-bar-timer';
import { SessionTopBar } from '@/components/session-view/session-top-bar';
import { uiRoles } from '@/components/ui/tokens';
import type { RestTimerView } from '@/src/session-recorder/rest-timer';

const REST: RestTimerView = {
  mode: 'rest', status: 'running', sessionId: 's', remainingSec: 83, formatted: '1:23', durationSec: 90,
};
const DONE: RestTimerView = { ...REST, status: 'completed', remainingSec: 0, formatted: '0:00' };
const repeating = (isPaused: boolean, round = 3): RestTimerView => ({
  mode: 'repeating', status: isPaused ? 'paused' : 'running', sessionId: 's',
  round, remainingSec: 42, formatted: '0:42', intervalSec: 60, isPaused,
});

const pillStyle = () => StyleSheet.flatten(screen.getByTestId('timer-pill').props.style);

describe('TitleBarTimer', () => {
  it('is the timer glyph while idle and a countdown pill while running', () => {
    const { rerender } = render(<TitleBarTimer onLongPress={jest.fn()} onPress={jest.fn()} testID="timer" view={{ status: 'idle' }} />);
    expect(screen.queryByTestId('timer-pill')).toBeNull();
    expect(screen.getByTestId('timer')).toHaveProp('accessibilityLabel', 'Start timer');

    rerender(<TitleBarTimer onLongPress={jest.fn()} onPress={jest.fn()} testID="timer" view={REST} />);
    expect(screen.getByTestId('timer-countdown')).toHaveTextContent('1:23');
    expect(pillStyle().backgroundColor).toBeUndefined();
  });

  it('inverts the pill when a rest finishes and dashes it while a repeating timer is paused', () => {
    const { rerender } = render(<TitleBarTimer onLongPress={jest.fn()} onPress={jest.fn()} testID="timer" view={DONE} />);
    expect(pillStyle().backgroundColor).toBe(uiRoles.ink);
    expect(screen.getByTestId('timer')).toHaveProp('accessibilityLabel', 'Rest complete');

    rerender(<TitleBarTimer onLongPress={jest.fn()} onPress={jest.fn()} testID="timer" view={repeating(true)} />);
    expect(pillStyle().borderStyle).toBe('dashed');
  });

  it('taps, long presses and offers both as accessibility actions', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    render(<TitleBarTimer onLongPress={onLongPress} onPress={onPress} testID="timer" view={REST} />);
    const control = screen.getByTestId('timer');
    expect(control.props.accessibilityHint).toBe('Stops the timer. Long press for the timer controls.');
    expect(control.props.accessibilityActions).toEqual([
      { name: 'activate' },
      { name: 'longpress', label: 'Open timer controls' },
    ]);
    fireEvent.press(control);
    fireEvent(control, 'longPress');
    fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
    expect(onPress).toHaveBeenCalledTimes(2);
    expect(onLongPress).toHaveBeenCalledTimes(2);
  });

  it.each<[string, RestTimerView, string, string]>([
    ['idle', { status: 'idle' }, 'Start timer', 'Starts the timer you last used.'],
    ['rest', REST, 'Rest timer, 1:23 remaining', 'Stops the timer.'],
    ['finished rest', DONE, 'Rest complete', 'Clears the timer.'],
    ['repeating', repeating(false), 'Repeating timer round 3, 0:42 remaining', 'Pauses the timer.'],
    ['paused repeating', repeating(true), 'Repeating timer round 3, 0:42 remaining, paused', 'Resumes the timer.'],
    ['preparing', repeating(false, 0), 'Repeating timer preparation, 0:42 remaining', 'Pauses the timer.'],
  ])('names a %s timer and what a tap does', (_, view, label, tapHint) => {
    expect(describeTitleBarTimer(view)).toMatchObject({ label, tapHint });
  });
});

type HostProps = { view: RestTimerView };
type Host = ReturnType<typeof useTitleBarTimer>;

describe('useTitleBarTimer', () => {
  const controls = (view: RestTimerView) => ({ view, toggleForSession: jest.fn(), tapTitleBar: jest.fn(), startLastMode: jest.fn() });

  it('off: no title-bar timer, and the card shows whenever a timer runs', () => {
    const { result, rerender } = renderHook<Host, HostProps>(({ view }) => useTitleBarTimer(controls(view), false), {
      initialProps: { view: { status: 'idle' } },
    });
    expect(result.current).toMatchObject({ cardVisible: false, titleBarTimer: undefined, collapseCard: undefined });
    rerender({ view: REST });
    expect(result.current.cardVisible).toBe(true);
  });

  it('on: the card shows only once opened, and closes on collapse or when the timer stops', () => {
    const timer = controls(REST);
    const { result, rerender } = renderHook<Host, HostProps>(({ view }) => useTitleBarTimer({ ...timer, view }, true), {
      initialProps: { view: REST },
    });
    expect(result.current.cardVisible).toBe(false);
    expect(result.current.titleBarTimer?.onPress).toBe(timer.tapTitleBar);

    act(() => result.current.titleBarTimer?.onLongPress());
    expect(timer.startLastMode).not.toHaveBeenCalled();
    expect(result.current.cardVisible).toBe(true);
    act(() => result.current.collapseCard?.());
    expect(result.current.cardVisible).toBe(false);

    act(() => result.current.titleBarTimer?.onLongPress());
    rerender({ view: { status: 'idle' } });
    rerender({ view: REST });
    expect(result.current.cardVisible).toBe(false);
  });

  it('on: no title-bar timer where the session cannot run one', () => {
    const { result } = renderHook(() => useTitleBarTimer({ ...controls(REST), toggleForSession: undefined }, true));
    expect(result.current.titleBarTimer).toBeUndefined();
  });

  it('on: a long press on an idle timer starts the last-used mode', () => {
    const timer = controls({ status: 'idle' });
    const { result } = renderHook(() => useTitleBarTimer(timer, true));
    act(() => result.current.titleBarTimer?.onLongPress());
    expect(timer.startLastMode).toHaveBeenCalledTimes(1);
  });
});

it('puts the title-bar timer in place of the session timer button', () => {
  const onToggle = jest.fn();
  const onPress = jest.fn();
  render(
    <SessionTopBar mode="active" onFinish={jest.fn()} onOpenOptions={jest.fn()} onToggleRestTimer={onToggle}
      startedAt={new Date(2026, 8, 23, 18, 0, 0)}
      titleBarTimer={{ view: REST, onPress, onLongPress: jest.fn() }} />,
  );
  expect(screen.getByTestId('session-view-rest-timer-button-countdown')).toHaveTextContent('1:23');
  fireEvent.press(screen.getByTestId('session-view-rest-timer-button'));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(onToggle).not.toHaveBeenCalled();
});
