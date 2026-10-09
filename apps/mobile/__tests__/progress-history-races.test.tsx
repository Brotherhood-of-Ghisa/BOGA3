import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as stats from '@/src/data/stats';
import type { SelectedMuscleWeeklyEffort } from '@/src/data';
import { useHistory, type HistorySubject } from '@/components/stats/use-history';
import { calendarWeekBounds } from '@/src/utils/calendar-weeks';

// Delayed reads are injected at the real repository boundary to prove races.
const weekly = (count: number): SelectedMuscleWeeklyEffort[] => [{
  weekStartDateKey: '2026-09-28', monthKey: '2026-09', weekOfMonth: 4,
  totalVolume: count, workingSetCount: count, estimatedRM1: null, highestWeight: null,
}];
const history = (count: number) => ({ weekly: weekly(count), daily: [] });
const muscle = (id: string): HistorySubject => ({ kind: 'muscle', id });
const deferred = () => {
  let resolve!: (rows: SelectedMuscleWeeklyEffort[]) => void;
  let reject!: (error: Error) => void;
  const rows = new Promise<SelectedMuscleWeeklyEffort[]>((done, fail) => { resolve = done; reject = fail; });
  return { promise: rows.then(weeks => ({ weekly: weeks, daily: [] })), resolve, reject };
};
// The page's own props: its subject, the saved window and the policy revision.
const renderHistory = (subject: HistorySubject | null, weeks = 52, revision = 0) =>
  renderHook(
    (props: { subject: HistorySubject | null; weeks: number; revision: number }) =>
      useHistory(props.subject, props.weeks, props.revision),
    { initialProps: { subject, weeks, revision } }
  );
// The read is deferred past the first frame, so each race syncs on its start.
const started = (times: number) =>
  waitFor(() => expect(stats.computeSelectedMuscleHistoryEffort).toHaveBeenCalledTimes(times));
afterEach(() => jest.restoreAllMocks());

it.each([{ id: '' }, { id: ' ' }, { subject: null }])('reads nothing for a subject without an id %j', ({ id }) => {
  const read = jest.spyOn(stats, 'computeSelectedMuscleHistoryEffort');
  const { result } = renderHistory(id === undefined ? null : muscle(id));
  expect(result.current.loading).toBe(false);
  expect(result.current.weekly).toEqual([]);
  expect(read).not.toHaveBeenCalled();
});

it('retries the same subject after a policy change without retaining old values', async () => {
  const read = jest.spyOn(stats, 'computeSelectedMuscleHistoryEffort')
    .mockResolvedValueOnce(history(4)).mockRejectedValueOnce(Error('read failed')).mockResolvedValueOnce(history(8));
  const { result, rerender } = renderHistory(muscle('quads'));
  await waitFor(() => expect(result.current.weekly).toEqual(weekly(4)));
  rerender({ subject: muscle('quads'), weeks: 52, revision: 1 });
  await waitFor(() => expect(result.current.error).toBe('read failed'));
  expect(result.current.weekly).toEqual([]);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.weekly).toEqual(weekly(8)));
  expect(result.current.error).toBeNull();
  expect(read).toHaveBeenCalledTimes(3);
  for (const [options] of read.mock.calls) {
    expect(options).toMatchObject({ muscleGroupIds: ['quads'], start: calendarWeekBounds(52).start });
  }
});

it.each(['success', 'failure'])('ignores a left subject’s late %s after another muscle opens', async outcome => {
  const old = deferred();
  jest.spyOn(stats, 'computeSelectedMuscleHistoryEffort').mockReturnValueOnce(old.promise).mockResolvedValue(history(8));
  const { result, rerender } = renderHistory(muscle('quads'));
  await started(1);
  rerender({ subject: muscle('chest'), weeks: 52, revision: 0 });
  await waitFor(() => expect(result.current.weekly).toEqual(weekly(8)));
  await act(async () => {
    if (outcome === 'success') old.resolve(weekly(100)); else old.reject(Error('old muscle'));
  });
  expect(result.current.weekly).toEqual(weekly(8));
  expect(result.current.error).toBeNull();
});

it.each(['success', 'failure'])('ignores a superseded window’s late %s', async outcome => {
  const old = deferred();
  jest.spyOn(stats, 'computeSelectedMuscleHistoryEffort').mockReturnValueOnce(old.promise).mockResolvedValue(history(8));
  const { result, rerender } = renderHistory(muscle('quads'));
  await started(1);
  rerender({ subject: muscle('quads'), weeks: 1, revision: 0 });
  await waitFor(() => expect(result.current.weekly).toEqual(weekly(8)));
  await act(async () => {
    if (outcome === 'success') old.resolve(weekly(100)); else old.reject(Error('old account/window'));
  });
  expect(result.current.weekly).toEqual(weekly(8));
  expect(result.current.error).toBeNull();
});

it('cannot publish an old account’s history into the next mounted account', async () => {
  const old = deferred();
  jest.spyOn(stats, 'computeSelectedMuscleHistoryEffort').mockReturnValueOnce(old.promise).mockResolvedValue(history(4));
  const accountA = renderHistory(muscle('quads'));
  await started(1);
  accountA.unmount();
  const accountB = renderHistory(muscle('chest'), 4);
  await waitFor(() => expect(accountB.result.current.weekly).toEqual(weekly(4)));
  await act(async () => old.resolve(weekly(100)));
  expect(accountB.result.current.weekly).toEqual(weekly(4));
});

it('publishes its loading state before starting the read, cancelling the read a left page scheduled', async () => {
  const read = jest.spyOn(stats, 'computeSelectedMuscleHistoryEffort').mockResolvedValue(history(4));
  const frames: FrameRequestCallback[] = [];
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  const cancel = jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  const { result, rerender } = renderHistory(muscle('quads'));
  // The page commits with its spinner; the read starts on the next frame.
  expect(result.current.loading).toBe(true);
  expect(read).not.toHaveBeenCalled();
  rerender({ subject: muscle('chest'), weeks: 52, revision: 0 });
  expect(cancel).toHaveBeenCalledWith(1);
  act(() => frames[1](0));
  await waitFor(() => expect(result.current.weekly).toEqual(weekly(4)));
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ muscleGroupIds: ['chest'] }));
});
