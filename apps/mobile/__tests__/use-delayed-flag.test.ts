import { act, renderHook } from '@testing-library/react-native';

import { useDelayedFlag } from '@/components/stats/use-delayed-flag';

describe('useDelayedFlag', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const render = (flag: boolean) => renderHook(({ on }: { on: boolean }) => useDelayedFlag(on, 100), { initialProps: { on: flag } });

  it('stays false while the flag is false', () => {
    const { result } = render(false);
    act(() => jest.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it('turns true only once the flag has held for the delay', () => {
    const { result } = render(true);
    expect(result.current).toBe(false);
    act(() => jest.advanceTimersByTime(99));
    expect(result.current).toBe(false);
    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it('never turns true when the flag clears within the delay', () => {
    const { result, rerender } = render(true);
    act(() => jest.advanceTimersByTime(60));
    rerender({ on: false });
    act(() => jest.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it('turns false in the same render the flag clears, and waits again when it returns', () => {
    const { result, rerender } = render(true);
    act(() => jest.advanceTimersByTime(100));
    expect(result.current).toBe(true);
    rerender({ on: false });
    expect(result.current).toBe(false);
    rerender({ on: true });
    expect(result.current).toBe(false);
    act(() => jest.advanceTimersByTime(100));
    expect(result.current).toBe(true);
  });
});
