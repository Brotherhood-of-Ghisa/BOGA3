/* eslint-disable import/first, @typescript-eslint/no-require-imports */

import { act, screen, within } from '@testing-library/react-native';

jest.mock('@/src/data/bootstrap', () => require('./helpers/local-data').localDataBootstrapModule());
jest.mock('@/src/preferences/hooks', () =>
  require('./helpers/react-compiler').requireWithReactCompiler('src/preferences/hooks.ts'));
jest.mock('@/src/exercise-catalog/list-preferences', () =>
  require('./helpers/react-compiler').requireWithReactCompiler('src/exercise-catalog/list-preferences.ts'));
jest.mock('@/components/session-planner/plan-sections', () =>
  require('./helpers/react-compiler').requireWithReactCompiler('components/session-planner/plan-sections.tsx'));
jest.mock('@/components/session-list/history-list', () =>
  require('./helpers/react-compiler').requireWithReactCompiler('components/session-list/history-list.tsx'));

let mockIsFocused = true;
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useRouter: () => ({ push: jest.fn(), dismissTo: jest.fn() }),
    useIsFocused: () => mockIsFocused,
    useLocalSearchParams: () => ({}),
    Stack: { Screen: () => null },
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(() => mockIsFocused ? callback() : undefined, [callback, mockIsFocused]);
    },
  };
});

import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { planRepository } from '@/src/session-planner';
import { updatePreferences } from '@/src/preferences/hooks';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { bootLocalApp, closeLocalData, localDataClient, resetLocalData } from './helpers/local-data';
import { requireWithReactCompiler } from './helpers/react-compiler';
import { renderWithTheme } from './helpers/theme';

const SessionsRoute = requireWithReactCompiler<typeof import('@/app/sessions')>('app/sessions.tsx').default;
const sessionId = 'date-format-history';
const startedAt = new Date(2026, 8, 17, 23, 45);
const completedAt = new Date(2026, 8, 18, 0, 45);
const scheduledFor = new Date(2026, 8, 17, 7, 30);

const readStoredDates = () => ({
  history: localDataClient().prepare('SELECT started_at, completed_at FROM sessions WHERE id = ?').get(sessionId),
  plans: localDataClient().prepare('SELECT scheduled_for FROM session_plans').all(),
});

beforeEach(() => { resetLocalData(); mockIsFocused = true; });
afterEach(() => closeLocalData());

it('keeps compiled planned and historical rows in the active date format through mounted returns and fresh opens', async () => {
  await bootLocalApp();
  await persistSessionDraftSnapshot({ sessionId, gymId: null, startedAt, exercises: [] });
  await completeSessionDraft(sessionId, { completedAt, now: completedAt });
  const saved = await planRepository.createPlan({
    title: 'Scheduled workout', gymId: null, scheduledFor,
    exercises: [{ exerciseDefinitionId: null, name: 'Back Squat',
      sets: [{ targetWeightText: '100', targetRepsText: '5', targetSetType: null }] }],
  });
  expect(saved.status).toBe('saved');
  if (saved.status !== 'saved') throw new Error('Plan fixture was not saved');
  const storedBefore = readStoredDates();
  let view = renderWithTheme(<SessionsRoute />);
  const planRowId = `sessions-plan-section-upcoming-row-${saved.id}`;
  const historyRowId = `completed-session-open-button-${sessionId}`;
  await screen.findByTestId(planRowId);
  await screen.findByTestId(historyRowId);
  const mountedPlan = screen.getByTestId(planRowId);
  const mountedHistory = screen.getByTestId(historyRowId);

  const formats: [ExerciseDateFormat, string, string][] = [
    ['DD-MM-YYYY', '17-09-2026', '14-09-2026 – 20-09-2026'],
    ['MM-DD-YYYY', '09-17-2026', '09-14-2026 – 09-20-2026'],
    ['YYYY-MM-DD', '2026-09-17', '2026-09-14 – 2026-09-20'],
    ['DD-MM-YYYY', '17-09-2026', '14-09-2026 – 20-09-2026'],
  ];
  const expectFormat = (date: string, week: string) => {
    expect(within(screen.getByTestId(planRowId)).getByText(`${date} 07:30 · 1 block`)).toBeTruthy();
    expect(screen.getByTestId(planRowId)).toHaveProp('accessibilityLabel', `Scheduled workout, ${date} 07:30`);
    expect(screen.getByTestId(`${historyRowId}-start`)).toHaveTextContent(`${date} 23:45`);
    expect(screen.getByTestId(historyRowId)).toHaveProp('accessibilityLabel', expect.stringContaining(`Completed session on ${date} 23:45`));
    expect(within(screen.getByTestId('completed-history-week-2026-09-14')).getByText(week)).toBeTruthy();
  };

  for (const [dateFormat, date, week] of formats) {
    mockIsFocused = false;
    view.rerender(<SessionsRoute />);
    await act(async () => { updatePreferences({ dateFormat }); });
    expectFormat(date, week);
    mockIsFocused = true;
    view.rerender(<SessionsRoute />);
    expectFormat(date, week);
    expect(screen.getByTestId(planRowId)).toBe(mountedPlan);
    expect(screen.getByTestId(historyRowId)).toBe(mountedHistory);
  }

  view.unmount();
  for (const [dateFormat, date, week] of formats) {
    await act(async () => { updatePreferences({ dateFormat }); });
    view = renderWithTheme(<SessionsRoute />);
    await screen.findByTestId(planRowId);
    await screen.findByTestId(historyRowId);
    expectFormat(date, week);
    view.unmount();
  }
  expect(readStoredDates()).toEqual(storedBefore);
});
