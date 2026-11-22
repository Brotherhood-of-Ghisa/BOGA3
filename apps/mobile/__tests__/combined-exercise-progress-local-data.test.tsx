/* eslint-disable import/first */
import * as mockReact from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted native-open replacement.
  require('./helpers/local-data').localDataBootstrapModule());

let mockSearchParams: Record<string, string | string[]> = {};
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockSetOptions = jest.fn();
jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('expo-router', () => ({
  Stack: { Screen: ({ options }: { options: { headerTitle?: () => mockReact.ReactNode; headerRight?: () => mockReact.ReactNode; headerLeft?: () => mockReact.ReactNode } }) =>
    mockReact.createElement(mockReact.Fragment, null, options.headerTitle?.(), options.headerRight?.(), options.headerLeft?.()) },
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useLocalSearchParams: () => mockSearchParams,
  useIsFocused: () => true,
  useRouter: () => ({ push: mockPush, back: mockBack, canGoBack: () => true, replace: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn() }),
  useFocusEffect: (callback: () => void | (() => void)) => mockReact.useEffect(() => callback(), [callback]),
}));

import StatsRoute from '@/app/(tabs)/progress';
import ProgressHistoryRoute, { resolveHistorySubject } from '@/app/progress-history';
import ExerciseHistoryRoute from '@/app/exercise-history';
import { bootLocalApp, closeLocalData, loadMaestroFixture, localDatabase, resetLocalData } from './helpers/local-data';
import { renderWithTheme } from './helpers/theme';
import { waitForGone } from './helpers/wait-for-gone';
import { setAccountLocalPreferenceAccount, ensureAccountLocalPreferencesLoaded } from '@/src/preferences/account-local';
import { updatePreferences } from '@/src/preferences/hooks';
import { exerciseDefinitions } from '@/src/data/schema';
import { persistSessionDraftSnapshot, completeSessionDraft } from '@/src/data/session-drafts';
import { progressHistoryHref, exerciseHistoryHref, historyDetailHref } from '@/src/navigation/routes';
import { calendarWeekBounds, localDateKey } from '@/src/utils/calendar-weeks';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { Sheet } from '@/components/ui';

const SQUAT = EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId;
const BENCH = EXERCISE_BLOCK_HISTORY_FIXTURE.secondaryExerciseId;
let six: { id: string; name: string }[];
let recentDate: Date;

beforeEach(async () => {
  resetLocalData(); mockSearchParams = {}; mockPush.mockClear(); mockBack.mockClear();
  setAccountLocalPreferenceAccount('combined-progress-tests', true);
  await ensureAccountLocalPreferencesLoaded();
  act(() => updatePreferences({ progressBreakdown: 'exercise', progressExerciseMetric: 'workingSetCount', heatmapView: 'daily' }));
  await loadMaestroFixture('exercise-block-history');
  six = localDatabase().select().from(exerciseDefinitions).all()
    .filter(exercise => !exercise.deletedAt && exercise.recordingMode === 'reps').slice(0, 6);
  const completedAt = new Date(Date.now() - 60 * 60 * 1000);
  recentDate = completedAt;
  await persistSessionDraftSnapshot({ sessionId: 'combined-session', startedAt: new Date(completedAt.getTime() - 30 * 60 * 1000), gymId: null,
    exercises: six.map((exercise, index) => ({ id: `combined-block-${index}`, exerciseDefinitionId: exercise.id, name: exercise.name,
      sets: [{ id: `combined-set-${index}`, weightValue: '30', repsValue: '5', setType: 'rir_2', performanceStatus: null }] })) }, { now: completedAt });
  await completeSessionDraft('combined-session', { completedAt, now: completedAt });
  await bootLocalApp();
});
afterEach(() => { jest.restoreAllMocks(); closeLocalData(); });

const openCombined = async (extra: Record<string, string> = {}) => {
  mockSearchParams = { exerciseDefinitionIds: JSON.stringify([SQUAT, BENCH]), metric: 'volume', ...extra };
  renderWithTheme(<ProgressHistoryRoute />);
  await screen.findByTestId('stats-exercise-history-heatmap');
};

it('conceals selection until a long press, keeps short-tap navigation, and opens the selected scope', async () => {
  renderWithTheme(<StatsRoute />);
  const squat = await screen.findByTestId(`stats-exercise-row-${SQUAT}`);
  expect(screen.queryByTestId('stats-exercise-selection-controls')).toBeNull();
  fireEvent.press(squat);
  expect(mockPush).toHaveBeenCalledWith(progressHistoryHref({ exerciseDefinitionId: SQUAT }, 'workingSetCount'));
  mockPush.mockClear();
  fireEvent(squat, 'longPress');
  expect(mockPush).not.toHaveBeenCalled();
  expect(screen.getByTestId('stats-exercise-selection-show')).toBeDisabled();
  expect(screen.queryByTestId('stats-search-input')).toBeNull();
  fireEvent.press(screen.getByTestId(`stats-exercise-row-${BENCH}`));
  fireEvent.press(screen.getByTestId('stats-exercise-selection-show'));
  expect(mockPush).toHaveBeenCalledWith(progressHistoryHref({ exerciseDefinitionIds: [SQUAT, BENCH] }, 'workingSetCount'));
  expect(screen.getByTestId('stats-exercise-selection-count')).toHaveTextContent('2 selected');
  fireEvent.press(screen.getByTestId('stats-exercise-selection-count'));
  expect(screen.getByTestId(`selected-exercise-${SQUAT}`)).toHaveTextContent('Barbell Back Squat');
});

it('offers selection as an accessibility action and enforces the five-exercise limit reversibly', async () => {
  renderWithTheme(<StatsRoute />);
  const first = await screen.findByTestId(`stats-exercise-row-${six[0].id}`);
  fireEvent(first, 'accessibilityAction', { nativeEvent: { actionName: 'selectExercise' } });
  for (const exercise of six.slice(1)) fireEvent.press(screen.getByTestId(`stats-exercise-row-${exercise.id}`));
  expect(screen.getByTestId('stats-exercise-selection-count')).toHaveTextContent('5 selected');
  expect(screen.getByTestId('stats-exercise-selection-limit')).toHaveTextContent('Choose up to 5 exercises.');
  fireEvent.press(screen.getByTestId(`stats-exercise-row-${six[0].id}`));
  fireEvent.press(screen.getByTestId(`stats-exercise-row-${six[5].id}`));
  await waitForGone(() => screen.queryByTestId('stats-exercise-selection-limit'));
  fireEvent.press(screen.getByTestId('stats-exercise-selection-cancel'));
  expect(screen.getByTestId('stats-search-input')).toBeTruthy();
  expect(screen.queryByTestId('stats-exercise-selection-controls')).toBeNull();
});

it('uses all three charts and only additive metrics, with a names sheet and direct chronological History link', async () => {
  await openCombined({ metric: '1rm', gymId: 'no-gym' });
  expect(screen.getByTestId('stats-exercise-history-metric-chip-totalVolume')).toBeTruthy();
  fireEvent.press(screen.getByTestId('stats-exercise-history-metric-chip'));
  expect(screen.getByTestId('stats-exercise-history-metric-chip-workingSetCount')).toBeTruthy();
  fireEvent.press(screen.getByTestId('stats-exercise-history-view-chip-weekly'));
  expect(await screen.findByTestId('stats-exercise-history-heatmap-panel-weekly')).toBeTruthy();
  fireEvent.press(screen.getByTestId('stats-exercise-history-view-chip-timeline'));
  expect(await screen.findByTestId('stats-exercise-history-timeline')).toBeTruthy();
  await screen.findByTestId('stats-exercise-history-week-sets');
  fireEvent.press(screen.getByTestId('progress-history-title'));
  expect(screen.getByTestId(`selected-exercise-${BENCH}`)).toHaveTextContent('Barbell Bench Press');
  const sheets = screen.UNSAFE_getAllByType(Sheet);
  act(() => sheets.find(sheet => sheet.props.testID === 'selected-exercises-sheet')!.props.onDismiss());
  fireEvent.press(screen.getByTestId('progress-history-options-button'));
  expect(screen.queryByTestId('progress-history-rm-curve')).toBeNull();
  expect(screen.queryByTestId('progress-history-add-to-session')).toBeNull();
  expect(screen.getAllByTestId(/^progress-history-muscle-/)).toHaveLength(7);
  expect(screen.getByTestId('progress-history-muscle-chest')).toHaveTextContent(/Primary/);
  expect(screen.getAllByTestId('progress-history-muscle-triceps')).toHaveLength(1);
  expect(screen.getByTestId('progress-history-muscle-triceps')).toHaveTextContent(/Secondary/);
  fireEvent.press(screen.getByTestId('progress-history-muscle-triceps'));
  expect(mockPush).toHaveBeenLastCalledWith(progressHistoryHref({ muscleGroupId: 'triceps', gymId: null }, 'workingSetCount'));
  fireEvent.press(screen.getByTestId('progress-history-options-button'));
  fireEvent.press(screen.getByTestId('progress-history-exercise-history'));
  expect(mockPush).toHaveBeenCalledWith(exerciseHistoryHref([SQUAT, BENCH], null));
});

it('carries the full selection and gym from day and weekly chart taps', async () => {
  const ids = six.slice(0, 2).map(exercise => exercise.id);
  await openCombined({ exerciseDefinitionIds: JSON.stringify(ids), metric: 'sets', gymId: 'no-gym' });
  const day = localDateKey(recentDate);
  const week = localDateKey(calendarWeekBounds(1, recentDate).start);
  fireEvent.press(screen.getByTestId(`stats-exercise-history-heatmap-cell-${day}`));
  expect(mockPush).toHaveBeenLastCalledWith(historyDetailHref({ exerciseDefinitionIds: ids, gymId: null }, { day }, 'workingSetCount'));
  fireEvent.press(screen.getByTestId('stats-exercise-history-view-chip-weekly'));
  fireEvent.press(await screen.findByTestId(`stats-exercise-history-heatmap-cell-${week}`));
  expect(mockPush).toHaveBeenLastCalledWith(historyDetailHref({ exerciseDefinitionIds: ids, gymId: null }, { week }, 'workingSetCount'));
});

it.each(['day', 'week'])('keeps all selected exercises labelled in the %s drill-down', async period => {
  const ids = six.slice(0, 2).map(exercise => exercise.id);
  mockSearchParams = { exerciseDefinitionIds: JSON.stringify(ids), metric: 'sets', gymId: 'no-gym',
    [period]: localDateKey(period === 'day' ? recentDate : calendarWeekBounds(1, recentDate).start) };
  renderWithTheme(<ProgressHistoryRoute />);
  const card = 'exercise-period-detail-sets-card-combined-block-0';
  expect(await screen.findByTestId(`${card}-exercise-name`)).toHaveTextContent(six[0].name);
  expect(screen.getByTestId('exercise-period-detail-sets-card-combined-block-1-exercise-name')).toHaveTextContent(six[1].name);
  expect(screen.queryByTestId('exercise-period-detail-sets-card-combined-block-2')).toBeNull();
  fireEvent.press(screen.getByTestId(card));
  await waitFor(() => expect(mockPush).toHaveBeenLastCalledWith('/completed-session/combined-session'));
});

it('shows one mixed chronological feed with exercise labels and no combined all-time bests', async () => {
  const ids = six.slice(0, 2).map(exercise => exercise.id);
  mockSearchParams = { exerciseDefinitionIds: JSON.stringify(ids), gymId: 'no-gym' };
  renderWithTheme(<ExerciseHistoryRoute />);
  await screen.findByTestId('exercise-history-exercise-name-combined-block-0');
  const cards = screen.getAllByTestId(/^exercise-history-session-card-combined-block-\d+$/);
  expect(cards.slice(0, 2).map(card => card.props.testID)).toEqual([
    'exercise-history-session-card-combined-block-0', 'exercise-history-session-card-combined-block-1',
  ]);
  expect(screen.getByTestId('exercise-history-exercise-name-combined-block-0')).toHaveTextContent(six[0].name);
  expect(screen.getByTestId('exercise-history-exercise-name-combined-block-1')).toHaveTextContent(six[1].name);
  expect(screen.queryByTestId('exercise-history-best-card')).toBeNull();
  expect(screen.queryByTestId('exercise-history-add-to-session')).toBeNull();
  fireEvent.press(screen.getByTestId('exercise-history-back'));
  expect(mockBack).toHaveBeenCalled();
});

it('rejects ambiguous, too-small and malformed selection routes', () => {
  for (const exerciseDefinitionIds of ['[]', '["one"]', 'broken']) expect(resolveHistorySubject({ exerciseDefinitionIds })).toBeNull();
  expect(resolveHistorySubject({ exerciseDefinitionId: SQUAT, exerciseDefinitionIds: JSON.stringify([SQUAT, BENCH]) })).toBeNull();
  expect(resolveHistorySubject({ muscleGroupId: 'quads', exerciseDefinitionIds: JSON.stringify([SQUAT, BENCH]) })).toBeNull();
});

it('renders stale selected definitions as unavailable rather than shrinking to the valid exercise', async () => {
  mockSearchParams = { exerciseDefinitionIds: JSON.stringify([SQUAT, 'missing']) };
  renderWithTheme(<ProgressHistoryRoute />);
  await waitFor(() => expect(screen.getByTestId('progress-history-unavailable')).toBeTruthy());
});
