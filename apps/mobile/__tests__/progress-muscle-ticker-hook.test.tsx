import { act, renderHook } from '@testing-library/react-native';
import * as mockReact from 'react';
import { useMuscleTickers } from '@/components/stats/use-muscle-tickers';
import { computeProgressMuscleTickers } from '@/src/data';
import type { ProgressMuscleTickers } from '@/src/data/progress-muscle-tickers';

const mockPreferences = { values: { historyLookbackWeeks: 52, targetWindowWeeks: 4, weeklyWorkingSetTarget: 8 }, accountRevision: 1 };
let mockRevision = 0;
jest.mock('@/src/data', () => ({ computeProgressMuscleTickers: jest.fn() }));
jest.mock('@/src/preferences/hooks', () => ({ useAccountLocalPreferenceState: () => mockPreferences }));
jest.mock('@/src/bodyweight/use-context-revision', () => ({ useBodyWeightContextRevision: () => mockRevision }));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void | (() => void)) => mockReact.useEffect(callback, [callback]) }));

const data = (): ProgressMuscleTickers => ({ start: new Date(2026, 0, 1), end: new Date(2026, 1, 1), rollingWeeks: 4, muscles: {} });
const read = jest.mocked(computeProgressMuscleTickers);
const deferred = () => {
  let resolve!: (value: ProgressMuscleTickers) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ProgressMuscleTickers>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
beforeEach(() => { read.mockReset(); mockRevision = 0; mockPreferences.accountRevision = 1; mockPreferences.values.targetWindowWeeks = 4; });

it('makes no ticker read for excluded views and isolates late gym/account/settings results', async () => {
  const old = deferred();
  const current = deferred();
  read.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const view = renderHook(({ enabled, gymId }: { enabled: boolean; gymId?: string | null }) => useMuscleTickers(enabled, gymId),
    { initialProps: { enabled: false, gymId: undefined } });
  expect(read).not.toHaveBeenCalled();
  view.rerender({ enabled: true, gymId: 'A' });
  expect(read).toHaveBeenLastCalledWith({ historyWeeks: 52, rollingWeeks: 4, weeklyTarget: 8, gymId: 'A' });
  mockPreferences.accountRevision = 2;
  mockPreferences.values.targetWindowWeeks = 2;
  view.rerender({ enabled: true, gymId: 'B' });
  await act(async () => { old.resolve(data()); });
  expect(view.result.current.data).toBeNull();
  await act(async () => { current.resolve(data()); });
  expect(view.result.current.status).toBe('loaded');
  expect(view.result.current.data).not.toBeNull();
  expect(read).toHaveBeenCalledTimes(2);
});

it('hides stale series on a changed training revision and exposes read failure without data', async () => {
  read.mockResolvedValueOnce(data());
  const view = renderHook(() => useMuscleTickers(true));
  await act(async () => { await Promise.resolve(); });
  expect(view.result.current.status).toBe('loaded');
  const pending = deferred();
  read.mockReturnValueOnce(pending.promise);
  mockRevision = 1;
  view.rerender({});
  expect(view.result.current.data).toBeNull();
  await act(async () => { pending.reject(new Error('read failed')); });
  expect(view.result.current.status).toBe('error');
  expect(view.result.current.data).toBeNull();
});
