import { act, renderHook, waitFor } from '@testing-library/react-native';
import { loadExerciseCatalogStatsRawHistory } from '@/src/data/exercise-catalog-stats';
import { __resetExerciseCatalogStatsCacheForTests, prepareExerciseHistoryReadForMaestro, useExerciseCatalogStats } from '@/src/exercise-catalog/stats-cache';

jest.mock('@/src/data/exercise-catalog-stats', () => ({
  ...jest.requireActual('@/src/data/exercise-catalog-stats'),
  loadExerciseCatalogStatsRawHistory: jest.fn(),
}));
let mockDev = false;
jest.mock('@/src/utils/isDevMode', () => ({ isDevMode: () => mockDev }));
const read = jest.mocked(loadExerciseCatalogStatsRawHistory);

beforeEach(() => { __resetExerciseCatalogStatsCacheForTests(); read.mockReset(); mockDev = false; });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it('refreshes Favourite against time even when the reader returns the same history object', async () => {
  const now = new Date('2026-09-25T12:00:00Z').getTime();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  const history = {
    sessions: [{ id: 's', completedAt: new Date(now - 179 * 86_400_000) }],
    sessionExercises: [{ id: 'se', sessionId: 's', exerciseDefinitionId: 'e' }],
    exerciseSets: [{ sessionExerciseId: 'se', weightValue: '20', repsValue: '8', setType: null }],
  };
  read.mockResolvedValue(history);
  const { result } = renderHook(() => useExerciseCatalogStats('all'));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.stats.recencyScoresById.has('e')).toBe(true);
  clock.mockReturnValue(now + 2 * 86_400_000);
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.stats.recencyScoresById.has('e')).toBe(false);
  expect(result.current.stats.aggregatesById.get('e')?.sessionCount).toBe(1);
  expect(result.current.stats.lastCompletedAtById.get('e')).toEqual(history.sessions[0].completedAt);
});

it('reports failed history distinctly and recovers through reload', async () => {
  read.mockRejectedValueOnce(new Error('disk read failed')).mockResolvedValue({ sessions: [], sessionExercises: [], exerciseSets: [] });
  const { result } = renderHook(() => useExerciseCatalogStats('all'));
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.rawHistory).toBeNull();
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.stats.everDoneIds.size).toBe(0);
});


it('ignores Maestro read faults outside development', async () => {
  read.mockResolvedValue({ sessions: [], sessionExercises: [], exerciseSets: [] });
  await prepareExerciseHistoryReadForMaestro('fail-once');
  const { result } = renderHook(() => useExerciseCatalogStats('all'));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(read).toHaveBeenCalledTimes(1);
});

it('exposes loading, fails one dev read, and retries without polling', async () => {
  mockDev = true;
  read.mockResolvedValue({ sessions: [], sessionExercises: [], exerciseSets: [] });
  await prepareExerciseHistoryReadForMaestro('fail-once');
  jest.useFakeTimers();
  const { result } = renderHook(() => useExerciseCatalogStats('all'));
  expect(result.current.status).toBe('loading');
  await act(async () => { await jest.advanceTimersByTimeAsync(2500); });
  expect(result.current.status).toBe('error');
  expect(read).not.toHaveBeenCalled();
  await act(async () => { result.current.reload(); });
  expect(result.current.status).toBe('ready');
  await act(async () => { await jest.advanceTimersByTimeAsync(3_600_000); });
  expect(read).toHaveBeenCalledTimes(1);
});
