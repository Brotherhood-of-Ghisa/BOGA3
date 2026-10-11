/**
 * `useGroupGlance`'s staleness rule over a controlled resource: a read for
 * windows other than those in view is never shown, and every such read that
 * lands asks once more — a refresh in flight when the week turned over still
 * carries the old windows (groups-screens.test.tsx covers the screen).
 */
import { renderHook } from '@testing-library/react-native';

import type { CompetitionPeriodTotalsWire } from '@/src/groups/competition-wire';
import { groupHomeSeriesWindows, toCompetitionPeriodWindows } from '@/src/groups/home-periods';
import { useGroupGlance } from '@/src/groups/use-group-glance';
import type { GroupResourceState } from '@/src/groups/use-group-resource';

const mockResource = jest.fn();
jest.mock('@/src/groups/use-group-resource', () => ({ useGroupResource: () => mockResource() }));

const NOW = new Date(2026, 9, 14, 18, 30);
const refresh = jest.fn(() => Promise.resolve());

const totals = (windows: { start_ms: number; end_ms: number }[]): CompetitionPeriodTotalsWire => ({
  contract_version: 4,
  group_id: 'g1',
  periods: windows.map((window) => ({ ...window, members: [] })),
});
const resource = (data: CompetitionPeriodTotalsWire | null, lastUpdatedAtMs: number | null): GroupResourceState<CompetitionPeriodTotalsWire> => ({
  data,
  lastUpdatedAtMs,
  hydrated: true,
  refreshing: false,
  offline: false,
  error: null,
  lostAccess: false,
  refresh,
});

const current = toCompetitionPeriodWindows(groupHomeSeriesWindows({ period: 'week', offset: 0, now: NOW }));
const lastWeek = toCompetitionPeriodWindows(groupHomeSeriesWindows({ period: 'week', offset: -1, now: NOW }));
const render = () => renderHook(() => useGroupGlance({ userId: 'me', groupId: 'g1', period: 'week', offset: 0, now: NOW }));

beforeEach(() => {
  refresh.mockClear();
});

it('shows a read for the windows in view and asks for nothing more', () => {
  mockResource.mockReturnValue(resource(totals(current), 1));
  const { result } = render();

  expect(result.current.series).toHaveLength(6);
  expect(refresh).not.toHaveBeenCalled();
});

it('hides a stale read and asks again each time another stale read lands', () => {
  mockResource.mockReturnValue(resource(totals(lastWeek), 1));
  const { result, rerender } = render();

  expect(result.current.series).toBeNull();
  expect(refresh).toHaveBeenCalledTimes(1);

  // The refresh that was already in flight lands, still for last week's windows.
  mockResource.mockReturnValue(resource(totals(lastWeek), 2));
  rerender({});
  expect(result.current.series).toBeNull();
  expect(refresh).toHaveBeenCalledTimes(2);

  // The next read answers this week: shown, and no further request.
  mockResource.mockReturnValue(resource(totals(current), 3));
  rerender({});
  expect(result.current.series).toHaveLength(6);
  expect(refresh).toHaveBeenCalledTimes(2);
});
