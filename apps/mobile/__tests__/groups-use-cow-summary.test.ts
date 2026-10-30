import { act, renderHook } from '@testing-library/react-native';
import { useCoWSummary } from '@/src/groups/use-cow-summary';
import { cowSummary } from './helpers/cow-fixtures';
const mockResource = jest.fn();
jest.mock('@/src/groups/use-group-resource', () => ({ useGroupResource: () => mockResource() }));
const refresh = jest.fn(() => Promise.resolve());
const summary = cowSummary();
const now = summary.observed_at_us / 1000;
const edge = summary.valid_until_us / 1000;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(now); refresh.mockClear();
  mockResource.mockReturnValue({ data: summary, lastUpdatedAtMs: now, refresh, offline: false });
});
afterEach(() => jest.useRealTimers());
it('hides the expired selection and refreshes exactly at the server calendar edge', () => {
  const { result } = renderHook(() => useCoWSummary('g1', 'u1'));
  expect(result.current.data).toBe(summary);
  act(() => jest.advanceTimersByTime(edge - now));
  expect(result.current.data).toBeNull();
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('refreshes when an in-flight read arrives already expired, and hides it while offline', () => {
  jest.setSystemTime(edge + 1);
  mockResource.mockReturnValue({ data: summary, lastUpdatedAtMs: now, refresh, offline: true });
  const { result } = renderHook(() => useCoWSummary('g1', 'u1'));
  expect(result.current.data).toBeNull();
  act(() => jest.advanceTimersByTime(0));
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('drops an old account/group response supplied as absent by the resource boundary and cancels its timer', () => {
  const { result, rerender, unmount } = renderHook(({ groupId, userId }: { groupId: string; userId: string }) => useCoWSummary(groupId, userId),
    { initialProps: { groupId: 'g1', userId: 'u1' } });
  mockResource.mockReturnValue({ data: null, lastUpdatedAtMs: null, refresh });
  rerender({ groupId: 'g2', userId: 'u2' });
  expect(result.current.data).toBeNull();
  unmount();
  act(() => jest.advanceTimersByTime(edge - now));
  expect(refresh).not.toHaveBeenCalled();
});

it('preserves confirmed unset-calendar absence without a zero-delay refresh loop', () => {
  mockResource.mockReturnValue({ data: { ...summary, week_start: null, selection: 'none', result: null, valid_until_us: summary.observed_at_us }, lastUpdatedAtMs: now, refresh });
  const { result } = renderHook(() => useCoWSummary('g1', 'u1'));
  act(() => jest.advanceTimersByTime(1000));
  expect(result.current.data).toMatchObject({ selection: 'none', result: null });
  expect(refresh).not.toHaveBeenCalled();
});
