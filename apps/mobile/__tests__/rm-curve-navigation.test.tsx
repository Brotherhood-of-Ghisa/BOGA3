/* eslint-disable import/first */
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { Stack, router as navigate } from 'expo-router';
import { Text } from 'react-native';
import { ScreenStackHeaderConfig } from 'react-native-screens';
import { eq } from 'drizzle-orm';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted native-open replacement.
  require('./helpers/local-data').localDataBootstrapModule());

import RmCurveRoute from '../app/rm-curve';
import ProgressHistoryRoute from '../app/progress-history';
import { exerciseDefinitions } from '@/src/data/schema';
import { persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { ensureExerciseCatalogLoaded } from '@/src/exercise-catalog/cache';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { progressHistoryHref, rmCurveHref } from '@/src/navigation/routes';
import { setAccountLocalPreferenceAccount, setAccountLocalPreferences } from '@/src/preferences/account-local';
import { closeLocalData, localDatabase, localDataClient, resetLocalData } from './helpers/local-data';
import { seedWaveHistory } from './helpers/rm-curve-history';
import { waitForGone } from './helpers/wait-for-gone';
import wave from './fixtures/rm-curve-weekly-wave.json';

// Router's test setup replaces Reanimated; retain the repository's native stubs.
const animationMock = jest.requireMock('react-native-reanimated');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- preserve the mock before router setup.
const { renderRouter } = require('expo-router/testing-library') as typeof import('expo-router/testing-library');
Object.assign(jest.requireMock('react-native-reanimated'), animationMock);

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'performance', 'queueMicrotask', 'hrtime'] });
  jest.setSystemTime(new Date(wave.scenarios.plateau[65].completedAt + 1));
  resetLocalData();
  setAccountLocalPreferenceAccount(null, false);
  setAccountLocalPreferences({ dateFormat: 'YYYY-MM-DD', historyLookbackWeeks: 52, heatmapView: 'timeline' });
  // local-data exposes the native handle type over the same migrated test database.
  seedWaveHistory(localDatabase() as unknown as Parameters<typeof seedWaveHistory>[0]);
  invalidateExerciseCatalogCache();
  await ensureExerciseCatalogLoaded();
});
afterEach(() => { jest.useRealTimers(); closeLocalData(); });

const open = (initialUrl: string) => renderRouter({
  _layout: () => <Stack />,
  'progress-history': ProgressHistoryRoute,
  'rm-curve': RmCurveRoute,
  '(tabs)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(tabs)/progress': () => <Text testID="returned-progress">Progress</Text>,
}, { initialUrl });

// Native-stack renders the title in UIKit, not as a JS Text/header element.
const nativeTitle = () => screen.UNSAFE_getAllByType(ScreenStackHeaderConfig).at(-1)!.props.title;

it('explains the model on request and preserves chart choices and set selection when dismissed', async () => {
  await open(String(rmCurveHref('curve')));
  await screen.findByTestId('rm-curve-plot');
  fireEvent.press(screen.getByTestId('rm-mode-two'));
  fireEvent.press(screen.getByTestId('rm-method-joint'));
  fireEvent(screen.getByTestId('rm-curve-plot'), 'accessibilityTap');
  await screen.findByTestId('rm-curve-details');
  expect(screen.queryByTestId('rm-curve-help')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'About the RM curve' }));
  const help = within(screen.getByTestId('rm-curve-help'));
  expect(help.getByText(/Heavy weights usually mean fewer reps/)).toBeTruthy();
  for (const name of ['Reading the chart', 'The soft halo', 'Gym, time and effort', 'One curve / Two curves',
    'Parsimonious / Rich', '1RM and fitting sessions', 'Exploratory fit']) {
    expect(help.getByRole('header', { name })).toBeTruthy();
  }
  expect(help.getByText(/eight reps with two left is plotted at ten/)).toBeTruthy();
  expect(help.getByText(/Rich uses errors estimated from your history/)).toBeTruthy();
  expect(help.getByText(/not proof that your strength changed/)).toBeTruthy();
  fireEvent.press(screen.getByTestId('rm-curve-help-backdrop', { includeHiddenElements: true }));
  await waitForGone(() => screen.queryByTestId('rm-curve-help'));
  expect(screen.getByTestId('rm-mode-two')).toHaveProp('accessibilityState', { selected: true });
  expect(screen.getByTestId('rm-method-joint')).toHaveProp('accessibilityState', { selected: true });
  expect(within(screen.getByTestId('rm-curve-details')).getByText('2026-06-01 · block 1, set 1')).toBeTruthy();
  expect(nativeTitle()).toBe('Synthetic exercise');
  fireEvent.press(screen.getByTestId('rm-curve-info'));
  fireEvent(screen.getByTestId('rm-curve-help'), 'accessibilityEscape');
  await waitForGone(() => screen.queryByTestId('rm-curve-help'));
  expect(screen.getByTestId('rm-curve-plot')).toBeTruthy();
});

it('pushes the selected exercise chart and returns to the same History metric/week without changing a workout draft', async () => {
  await persistSessionDraftSnapshot({ sessionId: 'active', gymId: null, startedAt: new Date(Date.now() - 60000),
    exercises: [{ id: 'active-block', exerciseDefinitionId: 'curve', name: 'Synthetic exercise',
      sets: [{ id: 'draft-set', weightValue: '92.5', repsValue: '5', setType: 'rir_2', performanceStatus: 'unperformed' }] }] });
  const draft = localDataClient().prepare("SELECT * FROM exercise_sets WHERE id = 'draft-set'").get();
  const route = await open(String(progressHistoryHref({ exerciseDefinitionId: 'curve' }, 'workingSetCount')));
  await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'));
  // The visual week duplicates the plot's accessible value and is hidden from VoiceOver.
  await screen.findByTestId('stats-exercise-history-timeline-readout-week', { includeHiddenElements: true });
  fireEvent.press(screen.getByLabelText('Previous week'));
  // The heading's words wrap in `FigureText`, which holds the label as its text.
  const week: string = screen.getByTestId('stats-exercise-history-timeline-readout-week', { includeHiddenElements: true }).props.children.props.children;
  fireEvent.press(screen.getByTestId('progress-history-options-button'));
  fireEvent.press(screen.getByTestId('progress-history-rm-curve'));
  await screen.findByTestId('rm-curve-plot');
  expect(route.getPathname()).toBe('/rm-curve');
  expect(nativeTitle()).toBe('Synthetic exercise');
  expect(within(screen.getByTestId('rm-curve-content')).getByRole('header', { name: 'RM curve' })).toBeTruthy();
  expect(screen.queryByLabelText(/^exercise:/)).toBeNull();
  expect(screen.getByText('90 sets · 30 sessions')).toBeTruthy();
  fireEvent(screen.getByTestId('rm-curve-plot'), 'accessibilityTap');
  expect(screen.getByText('2026-06-01 · block 1, set 1')).toBeTruthy();
  expect(screen.queryByTestId('rm-point-week-24:1')).toBeNull();
  fireEvent.press(screen.getByLabelText('range: History look-back (52 weeks)'));
  fireEvent.press(screen.getByRole('radio', { name: 'Progress period (4 weeks)' }));
  await screen.findByText('12 sets · 4 sessions');
  fireEvent.press(screen.getByTestId('rm-curve-back'));
  await screen.findByTestId('progress-history-screen');
  expect(route.getPathname()).toBe('/progress-history');
  expect(screen.getByTestId('stats-exercise-history-timeline-readout-week', { includeHiddenElements: true })).toHaveTextContent(week);
  // The metric chip still shows Sets: its label is the metric in force.
  expect(screen.getByTestId('stats-exercise-history-metric-chip-workingSetCount')).toHaveTextContent('Sets');
  expect(localDataClient().prepare("SELECT * FROM exercise_sets WHERE id = 'draft-set'").get()).toEqual(draft);
});

it.each([
  ['absent', '/rm-curve'], ['blank', '/rm-curve?exerciseDefinitionId=%20'],
  ['unknown', '/rm-curve?exerciseDefinitionId=missing'], ['deleted', '/rm-curve?exerciseDefinitionId=curve'],
])('keeps an unavailable %s exercise in route with a safe cold-entry Back', async (kind, href) => {
  if (kind === 'deleted') {
    localDatabase().update(exerciseDefinitions).set({ deletedAt: new Date() }).where(eq(exerciseDefinitions.id, 'curve')).run();
    invalidateExerciseCatalogCache(); await ensureExerciseCatalogLoaded();
  }
  const route = await open(href);
  await screen.findByText('This exercise isn’t available');
  expect(screen.queryByTestId('rm-curve-plot')).toBeNull();
  expect(nativeTitle()).toBe('RM curve');
  expect(screen.queryByLabelText(/^exercise:/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Choose exercise' })).toBeNull();
  fireEvent.press(screen.getByTestId('rm-curve-back'));
  await screen.findByTestId('returned-progress');
  expect(route.getPathname()).toBe('/progress');
});

it('encodes the canonical ID and resolves repeated parameters using the existing first-value convention', async () => {
  expect(rmCurveHref('exercise /?&=+')).toBe('/rm-curve?exerciseDefinitionId=exercise%20%2F%3F%26%3D%2B');
  await open('/rm-curve?exerciseDefinitionId=curve&exerciseDefinitionId=missing');
  await screen.findByTestId('rm-curve-plot');
  fireEvent(screen.getByTestId('rm-curve-plot'), 'accessibilityTap');
  expect(screen.getByText('2026-06-01 · block 1, set 1')).toBeTruthy();
});

it('resets the selected chart when a new exercise link reaches the mounted route', async () => {
  localDatabase().insert(exerciseDefinitions).values({ id: 'other', name: 'Another exercise', loadInputMode: 'total_load' }).run();
  invalidateExerciseCatalogCache(); await ensureExerciseCatalogLoaded();
  await open(String(rmCurveHref('curve')));
  await screen.findByTestId('rm-curve-plot');
  fireEvent(screen.getByTestId('rm-curve-plot'), 'accessibilityTap');
  fireEvent.press(screen.getByLabelText('range: History look-back (52 weeks)'));
  fireEvent.press(screen.getByRole('radio', { name: 'Progress period (4 weeks)' }));
  await screen.findByText('12 sets · 4 sessions');
  await act(async () => navigate.setParams({ exerciseDefinitionId: 'other' }));
  await screen.findByText('No completed sets');
  expect(nativeTitle()).toBe('Another exercise');
  await waitForGone(() => screen.queryByTestId('rm-curve-details'));
  expect(screen.getByLabelText('range: History look-back (52 weeks)')).toBeTruthy();
  expect(screen.queryByLabelText(/^exercise:/)).toBeNull();
});

it('refreshes the native exercise title after a rename and clears it after deletion', async () => {
  await open(String(rmCurveHref('curve')));
  await screen.findByTestId('rm-curve-plot');
  await act(async () => {
    localDatabase().update(exerciseDefinitions).set({ name: 'Single-arm cable lateral raise' }).where(eq(exerciseDefinitions.id, 'curve')).run();
    invalidateExerciseCatalogCache(); await ensureExerciseCatalogLoaded();
  });
  expect(nativeTitle()).toBe('Single-arm cable lateral raise');
  await act(async () => {
    localDatabase().update(exerciseDefinitions).set({ deletedAt: new Date() }).where(eq(exerciseDefinitions.id, 'curve')).run();
    invalidateExerciseCatalogCache(); await ensureExerciseCatalogLoaded();
  });
  expect(nativeTitle()).toBe('RM curve');
});

it('removes a live History action when its exercise is deleted while Options is open', async () => {
  const route = await open(String(progressHistoryHref({ exerciseDefinitionId: 'curve' })));
  fireEvent.press(await screen.findByTestId('progress-history-options-button'));
  expect(screen.getByTestId('progress-history-rm-curve')).toBeTruthy();
  await act(async () => {
    localDatabase().update(exerciseDefinitions).set({ deletedAt: new Date() }).where(eq(exerciseDefinitions.id, 'curve')).run();
    invalidateExerciseCatalogCache(); await ensureExerciseCatalogLoaded();
  });
  await waitForGone(() => screen.queryByTestId('progress-history-rm-curve'));
  expect(route.getPathname()).toBe('/progress-history');
});
