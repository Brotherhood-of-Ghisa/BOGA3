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
const history = (count: number) => ({ weekly: weekly(count), daily: [] });
const deferred = () => {
  let resolve!: (rows: SelectedMuscleWeeklyEffort[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<SelectedMuscleWeeklyEffort[]>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
afterEach(() => jest.restoreAllMocks());

it.each([{ ids: [] }, { ids: ['quads', 'chest'] }, { ids: [' '] }])('rejects a non-individual muscle target %j before reading', ({ ids }) => {
  const read = jest.spyOn(stats, 'computeSelectedMuscleHistoryEffort');
  const { result } = renderHook(() => useHistory(52, 0));
  act(() => result.current.select({ muscleGroupIds: ids }));
  expect(result.current.selected).toBeNull();
  expect(result.current.loading).toBe(false);
  expect(read).not.toHaveBeenCalled();
});

it('retries the same individual after a policy change without retaining old values, preserving its selected week', async () => {
  const read = jest.spyOn(stats, 'computeSelectedMuscleHistoryEffort')
    .mockResolvedValueOnce(history(4)).mockRejectedValueOnce(Error('read failed')).mockResolvedValueOnce(history(8));
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
  jest.spyOn(stats, 'computeSelectedMuscleHistoryEffort').mockReturnValueOnce(old.promise.then(rows => ({ weekly: rows, daily: [] }))).mockResolvedValue(history(8));
  const { result } = renderHook(() => useHistory(52, 0));
  act(() => result.current.select({ muscleGroupIds: ['quads'] }));
  await waitFor(() => expect(stats.computeSelectedMuscleHistoryEffort).toHaveBeenCalledTimes(1));
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
  jest.spyOn(stats, 'computeSelectedMuscleHistoryEffort').mockReturnValueOnce(old.promise.then(rows => ({ weekly: rows, daily: [] }))).mockResolvedValue(history(8));
  const { result, rerender } = renderHook(({ weeks }: { weeks: number }) => useHistory(weeks, 0), { initialProps: { weeks: 52 } });
  act(() => result.current.select({ muscleGroupIds: ['quads'] }));
  await waitFor(() => expect(stats.computeSelectedMuscleHistoryEffort).toHaveBeenCalledTimes(1));
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
  jest.spyOn(stats, 'computeSelectedMuscleHistoryEffort').mockReturnValueOnce(old.promise.then(rows => ({ weekly: rows, daily: [] }))).mockResolvedValue(history(4));
  const accountA = renderHook(() => useHistory(52, 0));
  act(() => accountA.result.current.select({ muscleGroupIds: ['quads'] }));
  await waitFor(() => expect(stats.computeSelectedMuscleHistoryEffort).toHaveBeenCalledTimes(1));
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
  jest.spyOn(stats, 'computeSelectedMuscleHistoryEffort').mockResolvedValueOnce(history(8)).mockReturnValueOnce(next.promise.then(rows => ({ weekly: rows, daily: [] }))).mockResolvedValue({ weekly: [], daily: [] });
  const { result, rerender } = renderHook(({ weeks }: { weeks: number }) => useHistory(weeks, 0), { initialProps: { weeks: 104 } });
  act(() => result.current.select({ muscleGroupIds: ['quads'] }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  const previous = localDateKey(calendarWeekBounds(104).start);
  act(() => result.current.selectWeek(previous));
  expect(result.current.weekKey).toBe(previous);
  rerender({ weeks: 1 });
  const current = localDateKey(calendarWeekBounds(1).start);
  expect(result.current.weekKey).toBe(current);
  await waitFor(() => expect(stats.computeSelectedMuscleHistoryEffort).toHaveBeenCalledTimes(2));
  await act(async () => next.reject(Error('new window read failed')));
  expect(result.current.error).toBe('new window read failed');
  expect(result.current.weekKey).toBe(current);
  rerender({ weeks: 104 });
  expect(result.current.weekKey).toBe(current);
});


it('publishes the target and loading state before starting the history read, cancelling a dismissed scheduled read', async () => {
  const read = jest.spyOn(stats, 'computeSelectedMuscleHistoryEffort').mockResolvedValue(history(4));
  const frames: FrameRequestCallback[] = [];
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  const cancel = jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  const { result } = renderHook(() => useHistory(52, 0));
  act(() => result.current.select({ muscleGroupIds: ['quads'] }));
  expect(result.current.selected).toEqual({ muscleGroupIds: ['quads'] });
  expect(result.current.loading).toBe(true);
  expect(read).not.toHaveBeenCalled();
  act(() => result.current.dismiss());
  expect(cancel).toHaveBeenCalledWith(1);
  expect(result.current.loading).toBe(false);
  act(() => result.current.select({ muscleGroupIds: ['chest'] }));
  act(() => frames[1](0));
  await waitFor(() => expect(result.current.weekly).toEqual(weekly(4)));
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ muscleGroupIds: ['chest'] }));
});
