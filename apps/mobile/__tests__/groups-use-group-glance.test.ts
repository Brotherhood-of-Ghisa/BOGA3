/**
 * `useGroupGlance`'s staleness rule over a controlled resource: a read for
 * windows other than those in view is never shown, and every such read that
 * lands asks once more — a refresh in flight when the week turned over still
 * carries the old windows. Its hold rule: after a step or a week/month switch
 * the last shown series stays, marked held, until the new read lands or
 * fails (groups-screens.test.tsx covers the screen).
 */
import { renderHook } from '@testing-library/react-native';

import { GroupApiError } from '@/src/groups/api';

import type { CompetitionPeriodTotalsWire } from '@/src/groups/competition-wire';
import { groupHomeSeriesWindows, toCompetitionPeriodWindows, type GroupHomePeriod } from '@/src/groups/home-periods';
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
const resource = (
  data: CompetitionPeriodTotalsWire | null,
  lastUpdatedAtMs: number | null,
  state: Partial<GroupResourceState<CompetitionPeriodTotalsWire>> = {},
): GroupResourceState<CompetitionPeriodTotalsWire> => ({
  data,
  lastUpdatedAtMs,
  hydrated: true,
  refreshing: false,
  offline: false,
  error: null,
  lostAccess: false,
  refresh,
  ...state,
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

describe('holding the last series while the next read lands', () => {
  type Props = { groupId: string; period: GroupHomePeriod; offset: number };
  const renderStepping = () =>
    renderHook((props: Props) => useGroupGlance({ userId: 'me', now: NOW, ...props }), {
      initialProps: { groupId: 'g1', period: 'week', offset: 0 },
    });
  const startOf = (series: { window: { start: Date } }[] | null) => series?.[5]?.window.start.getTime();

  it('keeps this week on a step back until last week lands, from the cache or the network', () => {
    mockResource.mockReturnValue(resource(totals(current), 1));
    const { result, rerender } = renderStepping();
    expect(result.current.held).toBeNull();

    // The new key before its cache read settles, then while the network read runs.
    mockResource.mockReturnValue(resource(null, null, { hydrated: false }));
    rerender({ groupId: 'g1', period: 'week', offset: -1 });
    expect(startOf(result.current.series)).toBe(current[5]!.start_ms);
    expect(result.current.held).toEqual({ period: 'week', offset: 0 });
    mockResource.mockReturnValue(resource(null, null, { refreshing: true }));
    rerender({ groupId: 'g1', period: 'week', offset: -1 });
    expect(result.current.held).toEqual({ period: 'week', offset: 0 });

    mockResource.mockReturnValue(resource(totals(lastWeek), 2));
    rerender({ groupId: 'g1', period: 'week', offset: -1 });
    expect(startOf(result.current.series)).toBe(lastWeek[5]!.start_ms);
    expect(result.current.held).toBeNull();
  });


  it('lets go once the next read fails or cannot run offline, so its own state shows', () => {
    mockResource.mockReturnValue(resource(totals(current), 1));
    const { result, rerender } = renderStepping();

    mockResource.mockReturnValue(resource(null, null, { error: new GroupApiError('INTERNAL', 'Boom') }));
    rerender({ groupId: 'g1', period: 'week', offset: -1 });
    expect(result.current.series).toBeNull();
    expect(result.current.held).toBeNull();

    mockResource.mockReturnValue(resource(null, null, { offline: true }));
    rerender({ groupId: 'g1', period: 'week', offset: -2 });
    expect(result.current.series).toBeNull();
    expect(result.current.held).toBeNull();
  });

  it("never holds one group's figures for another", () => {
    mockResource.mockReturnValue(resource(totals(current), 1));
    const { result, rerender } = renderStepping();

    mockResource.mockReturnValue(resource(null, null, { refreshing: true }));
    rerender({ groupId: 'g2', period: 'week', offset: 0 });
    expect(result.current.series).toBeNull();
    expect(result.current.held).toBeNull();
  });
});
