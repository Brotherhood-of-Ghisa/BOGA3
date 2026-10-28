/* eslint-disable import/first */
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: { currentState: 'active', addEventListener: jest.fn() },
}));

import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { useNovemberAppearance } from '@/components/appearance/use-november-appearance';
import { isNovember, watchNovemberAppearance } from '@/src/utils/seasonal-appearance';

const listeners = new Set<(state: AppStateStatus) => void>();
function changeState(state: AppStateStatus) {
  jest.replaceProperty(AppState, 'currentState', state);
  for (const listener of listeners) listener(state);
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 31, 23, 59, 59), doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  jest.replaceProperty(AppState, 'currentState', 'active');
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener);
    return { remove: () => { listeners.delete(listener); } };
  });
});

afterEach(() => {
  expect(listeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it.each([2026, 2027, 2032])('uses both local November boundaries every year (%s)', (year) => {
  expect(isNovember(new Date(year, 9, 31, 23, 59, 59, 999))).toBe(false);
  expect(isNovember(new Date(year, 10, 1))).toBe(true);
  expect(isNovember(new Date(year, 10, 30, 23, 59, 59, 999))).toBe(true);
  expect(isNovember(new Date(year, 11, 1))).toBe(false);
});

it('uses the device-local month of the instant, independent of the input offset', () => {
  expect(isNovember(new Date('2026-11-01T00:30:00+01:00'))).toBe(false);
  expect(isNovember(new Date('2026-10-31T23:30:00-01:00'))).toBe(true);
});

it('refreshes at startup and local midnight, then disposes its listener and timer', () => {
  const refresh = jest.fn();
  const stop = watchNovemberAppearance(refresh);
  expect(refresh.mock.calls).toEqual([[false]]);
  jest.advanceTimersByTime(1000);
  expect(refresh.mock.calls).toEqual([[false], [true]]);
  expect(jest.getTimerCount()).toBe(1);
  stop();
  jest.advanceTimersByTime(86400000);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('re-aims local midnight on foreground after a suspended calendar/zone change', () => {
  const refresh = jest.fn();
  const stop = watchNovemberAppearance(refresh);
  changeState('background');
  expect(jest.getTimerCount()).toBe(0);
  jest.setSystemTime(new Date(2026, 10, 30, 23, 59, 59));
  changeState('active');
  expect(refresh).toHaveBeenLastCalledWith(true);
  jest.advanceTimersByTime(1000);
  expect(refresh).toHaveBeenLastCalledWith(false);
  stop();
});

it('defers an inactive startup until foreground', () => {
  changeState('inactive');
  const refresh = jest.fn();
  const stop = watchNovemberAppearance(refresh);
  expect(refresh).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  changeState('active');
  expect(refresh).toHaveBeenCalledWith(false);
  stop();
});

it('updates the shared figure hook at both boundaries and after resume, with cleanup', () => {
  const { result, unmount } = renderHook(useNovemberAppearance);
  expect(result.current).toBe(false);
  act(() => jest.advanceTimersByTime(1000));
  expect(result.current).toBe(true);
  act(() => {
    changeState('background');
    jest.setSystemTime(new Date(2026, 11, 1));
    changeState('active');
  });
  expect(result.current).toBe(false);
  unmount();
});
