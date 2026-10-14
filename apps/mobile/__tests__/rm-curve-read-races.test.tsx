import { act, renderHook, waitFor } from '@testing-library/react-native';
import { waveGraph } from './helpers/rm-curve-history';
import { buildRmCurveModel, type RmCurveModel } from '@/src/rm-curve/model';
import { useRmCurve } from '@/src/rm-curve/use-rm-curve';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

// Only impossible-to-seed read timing/failure is injected; happy-path hooks use real SQLite elsewhere.
const query = { exerciseDefinitionId: 'curve', start: new Date(2026, 0, 5, 12),
  end: new Date(2026, 5, 16), historyLookbackWeeks: 52, accountRevision: 0 };
const model = (name: string) => buildRmCurveModel({ ...waveGraph(), definition: {
  id: 'curve', name, loadInputMode: 'total_load',
} }, query);

it('retains the same-scope data on failed refresh, exposes retry, and cleans up subscriptions', async () => {
  const first = model('First'), refreshed = model('Refreshed');
  const load = jest.fn().mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('Read failed')).mockResolvedValueOnce(refreshed);
  const hook = renderHook(({ revision }: { revision: number }) => useRmCurve({ ...query, refreshRevision: revision }, load),
    { initialProps: { revision: 0 } });
  await waitFor(() => expect(hook.result.current.data?.definition.name).toBe('First'));
  hook.rerender({ revision: 1 });
  await waitFor(() => expect(hook.result.current.status).toBe('error'));
  expect(hook.result.current.data).toBe(first); expect(hook.result.current.error).toBe('Read failed');
  act(() => hook.result.current.retry());
  await waitFor(() => expect(hook.result.current.data?.definition.name).toBe('Refreshed'));
  expect(hook.result.current.status).toBe('ready'); expect(hook.result.current.error).toBeNull();
  hook.unmount(); act(() => notifyLocalWrite()); expect(load).toHaveBeenCalledTimes(3);
});

it('hides stale data immediately and ignores older exercise/gym/effort/account reads that resolve last', async () => {
  const pending: ((value: RmCurveModel) => void)[] = [];
  const load = jest.fn(() => new Promise<RmCurveModel>(resolve => pending.push(resolve)));
  const props = { exercise: 'curve', gym: 'synthetic-gym' as string | null, rir: null as number | null, account: 0 };
  const hook = renderHook(({ exercise, gym, rir, account }: typeof props) => useRmCurve({ ...query,
    exerciseDefinitionId: exercise, gymId: gym, rir, accountRevision: account }, load), { initialProps: props });
  await waitFor(() => expect(pending).toHaveLength(1));
  await act(async () => pending[0](model('Initial')));
  expect(hook.result.current.data?.definition.name).toBe('Initial');
  hook.rerender({ ...props, exercise: 'other' }); expect(hook.result.current.data).toBeNull();
  await waitFor(() => expect(pending).toHaveLength(2));
  hook.rerender({ ...props, exercise: 'other', gym: null });
  await waitFor(() => expect(pending).toHaveLength(3));
  hook.rerender({ ...props, exercise: 'other', gym: null, rir: 0 });
  await waitFor(() => expect(pending).toHaveLength(4));
  hook.rerender({ ...props, exercise: 'other', gym: null, rir: 0, account: 1 });
  await waitFor(() => expect(pending).toHaveLength(5));
  await act(async () => pending[4](model('Current account')));
  await act(async () => { pending[1](model('Old exercise')); pending[2](model('Old gym')); pending[3](model('Old effort')); });
  expect(hook.result.current.data?.definition.name).toBe('Current account');
  expect(hook.result.current.status).toBe('ready'); hook.unmount();
});

it('cancels a scheduled read on unmount and returns a ready unavailable result for a missing exercise', async () => {
  const load = jest.fn().mockResolvedValue(null);
  const stopped = renderHook(() => useRmCurve(query, load)); stopped.unmount();
  const hook = renderHook(() => useRmCurve({ ...query, exerciseDefinitionId: 'missing' }, load));
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  expect(hook.result.current.data).toBeNull(); expect(load).toHaveBeenCalledTimes(1); hook.unmount();
});
