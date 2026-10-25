import { fireEvent, render, screen } from '@testing-library/react-native';

import { RestTimerBar } from '@/components/session-recorder/rest-timer-bar';
import type { RestTimerView } from '@/src/session-recorder/rest-timer';

describe('RestTimerBar', () => {
  it.each([false, true])('shows preparation without a round number (paused: %s)', (isPaused) => {
    render(
      <RestTimerBar
        onAdjust={jest.fn()}
        onDismiss={jest.fn()}
        onRestart={jest.fn()}
        view={{
          mode: 'repeating', status: isPaused ? 'paused' : 'preparing', sessionId: 'session-1',
          round: 0, remainingSec: 15, formatted: '0:15', intervalSec: 60, isPaused,
        }}
      />,
    );
    expect(screen.getByTestId('repeating-timer-round')).toHaveTextContent(isPaused ? 'Get ready · PAUSED' : 'Get ready');
    expect(screen.getByLabelText(`Repeating timer preparation, 0:15 remaining${isPaused ? ', paused' : ''}`)).toBeTruthy();
    expect(screen.queryByText(/Round 0/)).toBeNull();
  });

  it('offers a collapse control only when the host gives one', () => {
    const onCollapse = jest.fn();
    const view: RestTimerView = {
      mode: 'rest', status: 'running', sessionId: 'session-1', remainingSec: 60, formatted: '1:00', durationSec: 90,
    };
    const { rerender } = render(<RestTimerBar onAdjust={jest.fn()} onDismiss={jest.fn()} onRestart={jest.fn()} view={view} />);
    expect(screen.queryByTestId('rest-timer-collapse')).toBeNull();
    rerender(<RestTimerBar onAdjust={jest.fn()} onCollapse={onCollapse} onDismiss={jest.fn()} onRestart={jest.fn()} view={view} />);
    expect(screen.getByLabelText('Hide timer controls')).toBeTruthy();
    fireEvent.press(screen.getByTestId('rest-timer-collapse'));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when view is idle', () => {
    const idleView: RestTimerView = { status: 'idle' };
    render(
      <RestTimerBar
        onAdjust={jest.fn()}
        onDismiss={jest.fn()}
        onRestart={jest.fn()}
        view={idleView}
      />,
    );
    expect(screen.queryByTestId('rest-timer-bar')).toBeNull();
  });

  it('renders rest mode with controls and handles user actions', () => {
    const onAdjust = jest.fn();
    const onRestart = jest.fn();
    const onDismiss = jest.fn();
    const onSwitchMode = jest.fn();

    const restView: RestTimerView = {
      mode: 'rest',
      status: 'running',
      sessionId: 'session-1',
      remainingSec: 90,
      formatted: '1:30',
      durationSec: 90,
    };

    render(
      <RestTimerBar
        onAdjust={onAdjust}
        onDismiss={onDismiss}
        onRestart={onRestart}
        onSwitchMode={onSwitchMode}
        view={restView}
      />,
    );

    expect(screen.getByTestId('rest-timer-bar')).toBeTruthy();
    expect(screen.getByTestId('rest-timer-status')).toHaveTextContent('Rest');
    expect(screen.getByTestId('rest-timer-countdown')).toHaveTextContent('1:30');

    // Controls
    fireEvent.press(screen.getByTestId('rest-timer-minus-15'));
    expect(onAdjust).toHaveBeenCalledWith(-15);

    fireEvent.press(screen.getByTestId('rest-timer-plus-15'));
    expect(onAdjust).toHaveBeenCalledWith(15);

    fireEvent.press(screen.getByTestId('rest-timer-restart'));
    expect(onRestart).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('rest-timer-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // Mode selector
    fireEvent.press(screen.getByTestId('timer-mode-selector-repeating'));
    expect(onSwitchMode).toHaveBeenCalledWith('repeating');
  });

  it('renders rest completed view with Rest complete label', () => {
    const completedView: RestTimerView = {
      mode: 'rest',
      status: 'completed',
      sessionId: 'session-1',
      remainingSec: 0,
      formatted: '0:00',
      durationSec: 90,
    };

    render(
      <RestTimerBar
        onAdjust={jest.fn()}
        onDismiss={jest.fn()}
        onRestart={jest.fn()}
        view={completedView}
      />,
    );

    expect(screen.getByTestId('rest-timer-status')).toHaveTextContent('Rest complete');
    expect(screen.getByTestId('rest-timer-countdown')).toHaveTextContent('0:00');
  });

  it('renders repeating mode with round number, countdown, Pause/Resume, and Reset controls', () => {
    const onAdjust = jest.fn();
    const onRestart = jest.fn();
    const onDismiss = jest.fn();
    const onSwitchMode = jest.fn();
    const onToggleRepeating = jest.fn();
    const onResetRepeating = jest.fn();

    const runningRepeatingView: RestTimerView = {
      mode: 'repeating',
      status: 'running',
      sessionId: 'session-1',
      round: 3,
      remainingSec: 42,
      formatted: '0:42',
      intervalSec: 60,
      isPaused: false,
    };

    const { rerender } = render(
      <RestTimerBar
        onAdjust={onAdjust}
        onDismiss={onDismiss}
        onResetRepeating={onResetRepeating}
        onRestart={onRestart}
        onSwitchMode={onSwitchMode}
        onToggleRepeating={onToggleRepeating}
        view={runningRepeatingView}
      />,
    );

    expect(screen.getByTestId('repeating-timer-round')).toHaveTextContent('Round 3');
    expect(screen.getByTestId('repeating-timer-countdown')).toHaveTextContent('0:42');

    // Running shows "Pause"
    const toggleButton = screen.getByTestId('repeating-timer-toggle');
    expect(toggleButton).toHaveTextContent('Pause');
    fireEvent.press(toggleButton);
    expect(onToggleRepeating).toHaveBeenCalledTimes(1);

    // Reset button
    fireEvent.press(screen.getByTestId('repeating-timer-reset'));
    expect(onResetRepeating).toHaveBeenCalledTimes(1);

    // Interval adjustments
    fireEvent.press(screen.getByTestId('repeating-timer-minus-15'));
    expect(onAdjust).toHaveBeenCalledWith(-15);
    fireEvent.press(screen.getByTestId('repeating-timer-plus-15'));
    expect(onAdjust).toHaveBeenCalledWith(15);

    // Dismiss
    fireEvent.press(screen.getByTestId('rest-timer-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // Mode switch to Rest
    fireEvent.press(screen.getByTestId('timer-mode-selector-rest'));
    expect(onSwitchMode).toHaveBeenCalledWith('rest');

    // Paused state shows "Round 3 · PAUSED" and "Resume" button
    const pausedRepeatingView: RestTimerView = {
      ...runningRepeatingView,
      status: 'paused',
      isPaused: true,
    };
    rerender(
      <RestTimerBar
        onAdjust={onAdjust}
        onDismiss={onDismiss}
        onResetRepeating={onResetRepeating}
        onRestart={onRestart}
        onSwitchMode={onSwitchMode}
        onToggleRepeating={onToggleRepeating}
        view={pausedRepeatingView}
      />,
    );
    expect(screen.getByTestId('repeating-timer-round')).toHaveTextContent('Round 3 · PAUSED');
    expect(screen.getByTestId('repeating-timer-toggle')).toHaveTextContent('Resume');
  });
});
