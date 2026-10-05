import { act, render, screen } from '@testing-library/react-native';

import { SessionTopBar } from '@/components/session-view/session-top-bar';

afterEach(() => {
  jest.useRealTimers();
});

it('titles an active session by its time of day and ticks the elapsed time each second', () => {
  jest.useFakeTimers();
  const startedAt = new Date(2026, 8, 23, 18, 0, 0);
  let current = new Date(2026, 8, 23, 18, 42, 17);
  render(
    <SessionTopBar mode="active" now={() => current} onFinish={() => {}} onOpenOptions={() => {}} startedAt={startedAt} />
  );
  expect(screen.getByTestId('session-view-title')).toHaveTextContent('Evening training · 42:17');
  // A long title shrinks rather than truncating the elapsed time.
  expect(screen.getByTestId('session-view-title')).toHaveProp('adjustsFontSizeToFit', true);

  current = new Date(2026, 8, 23, 19, 2, 5);
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(screen.getByTestId('session-view-title')).toHaveTextContent('Evening training · 1:02:05');
});

it('keeps the fixed titles for an edited and a just-finished session', () => {
  const { rerender } = render(<SessionTopBar mode="completed" onDone={() => {}} />);
  expect(screen.getByText('Edit session')).toBeTruthy();
  expect(screen.queryByTestId('session-view-title')).toBeNull();
  rerender(<SessionTopBar mode="complete" onDone={() => {}} />);
  expect(screen.getByText('Session complete')).toBeTruthy();
});
