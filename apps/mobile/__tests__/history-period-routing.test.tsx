/* eslint-disable import/first */
import { Stack, router as navigate } from 'expo-router';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

jest.mock('@/src/data/bootstrap', () => require('./helpers/local-data').localDataBootstrapModule());
jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: null }) }));

import ProgressHistoryRoute from '../app/progress-history';
import ProgressRoute from '../app/(tabs)/progress';
import { seedStandardCatalogFixture } from '@/src/maestro/standard-catalog-fixture';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { ensureAccountLocalPreferencesLoaded, setAccountLocalPreferenceAccount } from '@/src/preferences/account-local';
import { updatePreferences } from '@/src/preferences/hooks';
import { persistSessionDraftSnapshot, completeSessionDraft } from '@/src/data/session-drafts';
import { loadActiveSessionId } from '@/src/session-entry';
import { closeLocalData, resetLocalData } from './helpers/local-data';

// Keep the repository's native stubs when Router installs its test setup.
const animationMock = jest.requireMock('react-native-reanimated');
const { renderRouter } = require('expo-router/testing-library') as typeof import('expo-router/testing-library');
Object.assign(jest.requireMock('react-native-reanimated'), animationMock);

const SQUAT = EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId;
const logWorkout = async (sessionId: string, completed = true) => {
  const completedAt = new Date(2026, 9, 2, 12);
  await persistSessionDraftSnapshot({ sessionId, startedAt: new Date(2026, 9, 2, 11), gymId: null,
    exercises: [{ id: `${sessionId}-squat`, exerciseDefinitionId: SQUAT, name: 'Barbell Back Squat', sets: [
      { id: `${sessionId}-done`, weightValue: '40', repsValue: '10', setType: 'rir_2', performanceStatus: null },
      { id: `${sessionId}-planned`, weightValue: '40', repsValue: '10', setType: 'rir_2', performanceStatus: 'planned' },
    ] }],
  }, { now: completed ? completedAt : new Date() });
  if (completed) await completeSessionDraft(sessionId, { completedAt, now: completedAt });
};

beforeEach(async () => {
  resetLocalData();
  setAccountLocalPreferenceAccount('routing', true);
  await ensureAccountLocalPreferencesLoaded();
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'performance', 'queueMicrotask', 'hrtime'] });
  jest.setSystemTime(new Date(2026, 9, 4, 12));
  await seedStandardCatalogFixture();
  await logWorkout('done');
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); closeLocalData(); });

const open = (initialUrl: string) => renderRouter({
  _layout: () => <Stack />,
  progress: ProgressRoute,
  'progress-history': ProgressHistoryRoute,
  sessions: () => <Text testID="sessions-destination">Sessions</Text>,
  train: () => <Text testID="train-destination">Train</Text>,
  'completed-session/[sessionId]': () => <Text testID="session-destination">Session</Text>,
}, { initialUrl });

it.each([
  ['muscle', 'daily'], ['muscle', 'weekly'], ['exercise', 'daily'], ['exercise', 'weekly'],
] as const)('keeps the %s subject from Progress Muscle through %s to sets, then Back', async (kind, view) => {
  act(() => updatePreferences({ heatmapView: view, progressMuscleLayout: 'list', progressMetric: 'workingSetCount' }));
  const router = await open('/progress?breakdown=muscle');
  if (kind === 'muscle') {
    await act(async () => fireEvent.press(await screen.findByTestId('stats-muscle-history-quads')));
  } else {
    await act(async () => fireEvent.press(await screen.findByTestId('stats-muscle-select-quads')));
    await act(async () => fireEvent.press(await screen.findByRole('link', { name: 'Open Barbell Back Squat history' })));
    await screen.findByTestId('stats-exercise-history-view-chip-row');
    await act(async () => fireEvent.press(screen.getByTestId(`stats-exercise-history-view-chip-${view}`)));
  }
  const key = view === 'daily' ? '2026-10-02' : '2026-09-28';
  const tile = await screen.findByTestId(`stats-${kind}-history-heatmap-cell-${key}`);
  await act(async () => fireEvent.press(tile));
  const card = await screen.findByTestId(`${kind}-period-detail-sets-card-done-squat`);
  expect(router.getPathname()).toBe('/progress-history');
  expect(screen.queryByTestId('sessions-destination')).toBeNull();
  expect(screen.queryByTestId('session-destination')).toBeNull();
  expect(screen.queryByText('Planned')).toBeNull();
  await act(async () => fireEvent.press(card));
  await screen.findByTestId('session-destination');
  expect(router.getPathname()).toBe('/completed-session/done');
  await act(async () => navigate.back());
  await screen.findByTestId(`${kind}-period-detail-sets-card-done-squat`);
  await act(async () => navigate.back());
  await screen.findByTestId(`stats-${kind}-history-heatmap-panel-${view}`);
});

it.each([['1rm', 'estimatedRM1'], ['weight', 'highestWeight']] as const)('retains exercise %s and no-gym scope in day detail', async (metric, value) => {
  await open(`/progress-history?exerciseDefinitionId=${SQUAT}&metric=${metric}&gymId=no-gym&view=daily`);
  const tile = await screen.findByTestId('stats-exercise-history-heatmap-cell-2026-10-02');
  await act(async () => fireEvent.press(tile));
  await screen.findByTestId('exercise-period-detail-sets-card-done-squat');
  expect(screen.getByTestId(`exercise-period-detail-metric-${value}`)).toBeTruthy();
  expect(screen.getByTestId('stats-exercise-history-gym')).toHaveProp('accessibilityLabel', 'Gym: No gym');
});

it.each(['muscle', 'exercise'] as const)('shows active performed sets in %s detail and opens Train only from the card', async kind => {
  await logWorkout('active', false);
  const subject = kind === 'muscle' ? 'muscleGroupId=quads' : `exerciseDefinitionId=${SQUAT}`;
  const router = await open(`/progress-history?${subject}&metric=sets&day=2026-10-04`);
  const card = await screen.findByTestId(`${kind}-period-detail-sets-card-active-squat`);
  expect(screen.queryByTestId('train-destination')).toBeNull();
  expect(screen.queryByTestId(`${kind}-period-detail-sets-empty`)).toBeNull();
  await act(async () => fireEvent.press(card));
  await screen.findByTestId('train-destination');
  expect(router.getPathname()).toBe('/train');
});

it('opens the displayed active workout after another becomes the default', async () => {
  await logWorkout('active', false);
  const router = await open(`/progress-history?exerciseDefinitionId=${SQUAT}&metric=sets&day=2026-10-04`);
  const card = await screen.findByTestId('exercise-period-detail-sets-card-active-squat');
  jest.setSystemTime(new Date(2026, 9, 4, 12, 1));
  await logWorkout('newer-active', false);
  expect(await loadActiveSessionId()).toBe('newer-active');
  await act(async () => fireEvent.press(card));
  await screen.findByTestId('train-destination');
  expect(router.getPathname()).toBe('/train');
});
