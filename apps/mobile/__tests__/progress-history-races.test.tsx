import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as stats from '@/src/data/stats';
import type { SelectedMuscleWeeklyEffort } from '@/src/data';
import { useHistory } from '@/components/stats/use-history';
import { calendarWeekBounds, localDateKey } from '@/src/utils/calendar-weeks';

// Delayed reads are injected at the real repository boundary to prove races.
const weekly = (count: number): SelectedMuscleWeeklyEffort[] => [{
  weekStartDateKey: '2026-09-28', monthKey: '2026-09', weekOfMonth: 4,
  totalVolume: count, workingSetCount: count, estimatedRM1: null, highestWeight: null,
}];
const deferred = () => {
  let resolve!: (rows: SelectedMuscleWeeklyEffort[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<SelectedMuscleWeeklyEffort[]>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
afterEach(() => jest.restoreAllMocks());

it.each([{ ids: [] }, { ids: ['quads', 'chest'] }, { ids: [' '] }])('rejects a non-individual muscle target %j before reading', ({ ids }) => {
  const read = jest.spyOn(stats, 'computeSelectedMuscleWeeklyEffort');
  const { result } = renderHook(() => useHistory(52, 0));
  act(() => result.current.select({ muscleGroupIds: ids }));
  expect(result.current.selected).toBeNull();
  expect(result.current.loading).toBe(false);
  expect(read).not.toHaveBeenCalled();
});

it('retries the same individual after a policy change without retaining old values, preserving its selected week', async () => {
  const read = jest.spyOn(stats, 'computeSelectedMuscleWeeklyEffort')
    .mockResolvedValueOnce(weekly(4)).mockRejectedValueOnce(Error('read failed')).mockResolvedValueOnce(weekly(8));
  jest.spyOn(stats, 'computeSelectedMuscleDailyEffortMetrics').mockResolvedValue([]);
  const { result, rerender } = renderHook(({ revision }: { revision: number }) => useHistory(52, revision), { initialProps: { revision: 0 } });
  act(() => result.current.select({ muscleGroupIds: ['quads'] }));
  await waitFor(() => expect(result.current.weekly).toEqual(weekly(4)));
  const selected = localDateKey(calendarWeekBounds(52).start);
  act(() => result.current.selectWeek(selected));
  rerender({ revision: 1 });
  await waitFor(() => expect(result.current.error).toBe('read failed'));
  expect(result.current.weekly).toEqual([]);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.weekly).toEqual(weekly(8)));
  expect(result.current.error).toBeNull();
  expect(result.current.weekKey).toBe(selected);
  expect(result.current.selected).toEqual({ muscleGroupIds: ['quads'] });
  expect(read).toHaveBeenCalledTimes(3);
  for (const [options] of read.mock.calls) {
    expect(options).toMatchObject({ muscleGroupIds: ['quads'], start: calendarWeekBounds(52).start });
  }
});

it.each(['success', 'failure'])('ignores a dismissed target’s late %s after opening another muscle', async outcome => {
  const old = deferred();
  jest.spyOn(stats, 'computeSelectedMuscleWeeklyEffort').mockReturnValueOnce(old.promise).mockResolvedValue(weekly(8));
  jest.spyOn(stats, 'computeSelectedMuscleDailyEffortMetrics').mockResolvedValue([]);
  const { result } = renderHook(() => useHistory(52, 0));
  act(() => result.current.select({ muscleGroupIds: ['quads'] }));
  act(() => result.current.dismiss());
  act(() => result.current.select({ muscleGroupIds: ['chest'] }));
  await waitFor(() => expect(result.current.weekly).toEqual(weekly(8)));
  await act(async () => {
    if (outcome === 'success') old.resolve(weekly(100)); else old.reject(Error('old muscle'));
  });
  expect(result.current.selected).toEqual({ muscleGroupIds: ['chest'] });
  expect(result.current.weekly).toEqual(weekly(8));
  expect(result.current.error).toBeNull();
});

it.each(['success', 'failure'])('ignores a superseded window’s late %s', async outcome => {
  const old = deferred();
  jest.spyOn(stats, 'computeSelectedMuscleWeeklyEffort').mockReturnValueOnce(old.promise).mockResolvedValue(weekly(8));
  jest.spyOn(stats, 'computeSelectedMuscleDailyEffortMetrics').mockResolvedValue([]);
  const { result, rerender } = renderHook(({ weeks }: { weeks: number }) => useHistory(weeks, 0), { initialProps: { weeks: 52 } });
  act(() => result.current.select({ muscleGroupIds: ['quads'] }));
  rerender({ weeks: 1 });
  await waitFor(() => expect(result.current.weekly).toEqual(weekly(8)));
  await act(async () => {
    if (outcome === 'success') old.resolve(weekly(100)); else old.reject(Error('old account/window'));
  });
  expect(result.current.weekly).toEqual(weekly(8));
  expect(result.current.error).toBeNull();
});

it('cannot publish an old account’s history into the next mounted account', async () => {
  const old = deferred();
  jest.spyOn(stats, 'computeSelectedMuscleWeeklyEffort').mockReturnValueOnce(old.promise).mockResolvedValue(weekly(4));
  jest.spyOn(stats, 'computeSelectedMuscleDailyEffortMetrics').mockResolvedValue([]);
  const accountA = renderHook(() => useHistory(52, 0));
  act(() => accountA.result.current.select({ muscleGroupIds: ['quads'] }));
  accountA.unmount();
  const accountB = renderHook(() => useHistory(4, 0));
  act(() => accountB.result.current.select({ muscleGroupIds: ['chest'] }));
  await waitFor(() => expect(accountB.result.current.weekly).toEqual(weekly(4)));
  act(() => accountB.result.current.selectWeek(null));
  expect(accountB.result.current.weekKey).toBeNull();
  await act(async () => old.resolve(weekly(100)));
  expect(accountB.result.current.weekly).toEqual(weekly(4));
});

it('resets an excluded week immediately even when the shortened-window read fails', async () => {
  const next = deferred();
  jest.spyOn(stats, 'computeSelectedMuscleWeeklyEffort').mockResolvedValueOnce(weekly(8)).mockReturnValueOnce(next.promise).mockResolvedValue([]);
  jest.spyOn(stats, 'computeSelectedMuscleDailyEffortMetrics').mockResolvedValue([]);
  const { result, rerender } = renderHook(({ weeks }: { weeks: number }) => useHistory(weeks, 0), { initialProps: { weeks: 104 } });
  act(() => result.current.select({ muscleGroupIds: ['quads'] }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  const previous = localDateKey(calendarWeekBounds(104).start);
  act(() => result.current.selectWeek(previous));
  expect(result.current.weekKey).toBe(previous);
  rerender({ weeks: 1 });
  const current = localDateKey(calendarWeekBounds(1).start);
  expect(result.current.weekKey).toBe(current);
  await act(async () => next.reject(Error('new window read failed')));
  expect(result.current.error).toBe('new window read failed');
  expect(result.current.weekKey).toBe(current);
  rerender({ weeks: 104 });
  expect(result.current.weekKey).toBe(current);
});
