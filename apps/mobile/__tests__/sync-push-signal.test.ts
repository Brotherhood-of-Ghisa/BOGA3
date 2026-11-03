/** The rows-pushed seam (`src/sync/push-signal.ts`): fan-out, isolation and the last push time. */
import { getLastRowsPushedAtMs, notifyRowsPushed, subscribeToRowsPushed } from '@/src/sync/push-signal';

it('records the push time and tells every listener, even after one throws', () => {
  jest.useFakeTimers();
  jest.setSystemTime(5_000);
  const failing = jest.fn(() => {
    throw new Error('listener failed');
  });
  const listener = jest.fn();
  subscribeToRowsPushed(failing);
  const unsubscribe = subscribeToRowsPushed(listener);

  expect(getLastRowsPushedAtMs()).toBeNull();
  expect(() => notifyRowsPushed()).not.toThrow();
  expect(failing).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(getLastRowsPushedAtMs()).toBe(5_000);

  unsubscribe();
  notifyRowsPushed();
  expect(listener).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
