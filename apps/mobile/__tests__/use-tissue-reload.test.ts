import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useTissueReloadMetrics } from '@/src/injuries/use-tissue-reload';
import type { InjuryView } from '@/src/data/injuries';
import type { TissueReloadMetrics } from '@/src/injuries/tissue-reload';


let mockSubscriber: (() => void) | null = null;
jest.mock('@/src/data/injury-invalidation', () => ({
  subscribeToInjuries: (cb: () => void) => {
    mockSubscriber = cb;
    return () => {
      mockSubscriber = null;
    };
  },
}));

const mockLoadAggregationInput = jest.fn();

jest.mock('@/src/data/stats', () => ({
  createDrizzleStatsStore: () => ({
    loadAggregationInput: (...args: unknown[]) => mockLoadAggregationInput(...args),
  }),
}));

const makeInjury = (overrides: Partial<InjuryView> = {}): InjuryView => ({
  id: overrides.id ?? 'inj-1',
  muscleGroupId: overrides.muscleGroupId ?? 'quads',
  muscleGroupName: overrides.muscleGroupName ?? 'Quadriceps',
  side: overrides.side ?? 'left',
  status: overrides.status ?? 'managing',
  painScore: overrides.painScore ?? 4,
  label: overrides.label ?? 'Quad Strain',
  notes: null,
  contraindications: null,
  startedAt: overrides.startedAt ?? new Date('2026-05-15T12:00:00Z'),
  resolvedAt: null,
  createdAt: new Date('2026-05-15T12:00:00Z'),
  updatedAt: new Date('2026-05-15T12:00:00Z'),
});

describe('useTissueReloadMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadAggregationInput.mockResolvedValue({
      sessions: [],
      sessionExercises: [],
      exerciseSets: [],
      muscleMappings: [],
      muscleGroups: [],
      exerciseDefinitions: [],
    });
  });

  it('returns providedMetrics directly when passed', () => {
    const provided: TissueReloadMetrics[] = [
      {
        injuryId: 'inj-1',
        muscleGroupId: 'quads',
        muscleGroupName: 'Quadriceps',
        label: 'Quad Strain',
        side: 'left',
        status: 'managing',
        painScore: 4,
        baselineWeeklyAverage: 4.0,
        currentWeeklyWorkingSets: 6,
        currentWeeklyRehabSets: 2,
        currentWeeklyRehabVolumeKg: 300,
        spikePercent: 50,
        isCautionAlert: true,
        cautionThreshold: 5.2,
      },
    ];

    const { result } = renderHook(() => useTissueReloadMetrics([], provided));
    expect(result.current).toEqual(provided);
  });

  it('returns empty array when activeInjuries is undefined or empty', () => {
    const { result: r1 } = renderHook(() => useTissueReloadMetrics(undefined));
    expect(r1.current).toEqual([]);

    const { result: r2 } = renderHook(() => useTissueReloadMetrics([]));
    expect(r2.current).toEqual([]);
  });

  it('returns empty array when all injuries are resolved', () => {
    const resolved = makeInjury({ status: 'resolved' });
    const { result } = renderHook(() => useTissueReloadMetrics([resolved]));
    expect(result.current).toEqual([]);
  });

  it('loads and computes metrics for live injuries with custom now', async () => {
    const injuryLater = makeInjury({
      id: 'inj-2',
      status: 'managing',
      startedAt: new Date('2026-05-10T12:00:00Z'),
    });
    const injuryEarlier = makeInjury({
      id: 'inj-1',
      status: 'acute',
      startedAt: new Date('2026-05-01T12:00:00Z'),
    });

    const { result } = renderHook(() =>
      useTissueReloadMetrics([injuryLater, injuryEarlier], undefined, {
        now: new Date('2026-05-15T12:00:00Z'),
      })
    );

    await waitFor(() => {
      expect(result.current).toHaveLength(2);
    });
  });

  it('handles stats store rejection gracefully', async () => {
    mockLoadAggregationInput.mockRejectedValueOnce(new Error('DB failure'));

    const live = makeInjury({ id: 'inj-live', status: 'acute' });
    const { result } = renderHook(() => useTissueReloadMetrics([live]));

    await waitFor(() => {
      expect(mockLoadAggregationInput).toHaveBeenCalled();
    });
    expect(result.current).toEqual([]);
  });

  it('reloads when injury subscriber notifies', async () => {
    const live = makeInjury({ id: 'inj-live', status: 'acute' });
    const { result } = renderHook(() => useTissueReloadMetrics([live]));

    await waitFor(() => {
      expect(result.current).toHaveLength(1);
    });

    // Fire subscription update
    act(() => {
      mockSubscriber?.();
    });
    await waitFor(() => {
      expect(mockLoadAggregationInput).toHaveBeenCalledTimes(2);
    });
  });
});
