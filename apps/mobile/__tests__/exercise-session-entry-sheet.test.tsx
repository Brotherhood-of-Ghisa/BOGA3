/* eslint-disable import/first */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';
import { Modal } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native open only.
  require('./helpers/local-data').localDataBootstrapModule());
const mockDismissTo = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ dismissTo: mockDismissTo }) }));

import { ExerciseSessionEntrySheet } from '@/components/session-recorder/exercise-session-entry-sheet';
import * as history from '@/src/data/exercise-block-history';
import * as drafts from '@/src/data/session-drafts';
import { sessions } from '@/src/data/schema';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { renderWithTheme } from './helpers/theme';
import { closeLocalData, loadMaestroFixture, localDatabase, resetLocalData } from './helpers/local-data';

const SQUAT = { id: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId, name: 'Barbell Back Squat' };
const PULLDOWN = { id: EXERCISE_BLOCK_HISTORY_FIXTURE.noHistoryExerciseId, name: 'Lat Pulldown' };
const activeRows = () => localDatabase().select().from(sessions).where(eq(sessions.status, 'active')).all();
const modal = () => screen.UNSAFE_getAllByType(Modal).find(node => node.props.testID === 'exercise-session-entry-sheet-modal')!;

beforeEach(async () => { resetLocalData(); jest.clearAllMocks(); await loadMaestroFixture('exercise-block-history'); });
afterEach(() => { jest.restoreAllMocks(); closeLocalData(); });

it('offers the previous sets without starting a workout, and cancellation writes nothing', async () => {
  const onDismiss = jest.fn();
  renderWithTheme(<ExerciseSessionEntrySheet exercise={SQUAT} onDismiss={onDismiss} />);
  await screen.findByTestId('exercise-picker-plan-source');
  expect(screen.getByTestId('exercise-picker-repeat-last-button')).toBeEnabled();
  expect(activeRows()).toHaveLength(0);
  fireEvent.press(screen.getByTestId('exercise-session-entry-sheet-backdrop', { includeHiddenElements: true }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(activeRows()).toHaveLength(0);
});

it('starts once on rapid taps and navigates only after native sheet dismissal', async () => {
  const onDismiss = jest.fn();
  renderWithTheme(<ExerciseSessionEntrySheet exercise={SQUAT} onDismiss={onDismiss} />);
  await screen.findByTestId('exercise-picker-plan-source');
  const button = screen.getByTestId('exercise-picker-add-empty-set-button');
  fireEvent.press(button);
  fireEvent.press(button);
  await waitFor(() => expect(modal().props.visible).toBe(false));
  expect(activeRows()).toHaveLength(1);
  const snapshot = (await drafts.loadSessionSnapshotById(activeRows()[0].id))!;
  expect(snapshot.exercises[0].sets).toHaveLength(1);
  expect(mockDismissTo).not.toHaveBeenCalled();
  act(() => modal().props.onDismiss());
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(mockDismissTo).toHaveBeenCalledWith('/train');
});

it('keeps empty available when there is no history', async () => {
  renderWithTheme(<ExerciseSessionEntrySheet exercise={PULLDOWN} onDismiss={jest.fn()} />);
  await screen.findByText('No earlier workout to repeat.');
  expect(screen.getByTestId('exercise-picker-repeat-last-button')).toBeDisabled();
  expect(screen.getByTestId('exercise-picker-add-empty-set-button')).toBeEnabled();
});

it('allows an empty start while the historical read is still pending (a slow read)', async () => {
  jest.spyOn(history, 'loadSuggestedExercisePlan').mockImplementationOnce(() => new Promise(() => undefined));
  renderWithTheme(<ExerciseSessionEntrySheet exercise={SQUAT} onDismiss={jest.fn()} />);
  expect(screen.getByTestId('exercise-picker-repeat-last-button')).toBeDisabled();
  fireEvent.press(screen.getByTestId('exercise-picker-add-empty-set-button'));
  await waitFor(() => expect(modal().props.visible).toBe(false));
  expect(activeRows()).toHaveLength(1);
});

it('retries failed history loading without starting anything (a failed read)', async () => {
  jest.spyOn(history, 'loadSuggestedExercisePlan').mockRejectedValueOnce(new Error('history read'));
  renderWithTheme(<ExerciseSessionEntrySheet exercise={SQUAT} onDismiss={jest.fn()} />);
  fireEvent.press(await screen.findByTestId('exercise-session-entry-retry'));
  await screen.findByTestId('exercise-picker-plan-source');
  expect(activeRows()).toHaveLength(0);
});

it('keeps the sheet open and can retry a failed save without an empty workout (a failed write)', async () => {
  jest.spyOn(drafts, 'persistSessionDraftSnapshot').mockRejectedValueOnce(new Error('Disk full. Try again.'));
  renderWithTheme(<ExerciseSessionEntrySheet exercise={SQUAT} onDismiss={jest.fn()} />);
  await screen.findByTestId('exercise-picker-plan-source');
  fireEvent.press(screen.getByTestId('exercise-picker-add-empty-set-button'));
  expect(await screen.findByTestId('exercise-session-entry-error')).toHaveTextContent('Disk full. Try again.');
  expect(activeRows()).toHaveLength(0);
  expect(modal().props.visible).toBe(true);
  fireEvent.press(screen.getByTestId('exercise-picker-add-empty-set-button'));
  await waitFor(() => expect(modal().props.visible).toBe(false));
  expect(activeRows()).toHaveLength(1);
});


it('disables history Retry during a pending empty save so the completion cannot be discarded', async () => {
  jest.spyOn(history, 'loadSuggestedExercisePlan').mockRejectedValueOnce(new Error('history read'));
  const save = drafts.persistSessionDraftSnapshot;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  jest.spyOn(drafts, 'persistSessionDraftSnapshot').mockImplementationOnce(async (...args) => { await pending; return save(...args); });
  renderWithTheme(<ExerciseSessionEntrySheet exercise={SQUAT} onDismiss={jest.fn()} />);
  await screen.findByTestId('exercise-session-entry-retry');
  fireEvent.press(screen.getByTestId('exercise-picker-add-empty-set-button'));
  expect(screen.getByTestId('exercise-session-entry-retry')).toBeDisabled();
  fireEvent.press(screen.getByTestId('exercise-session-entry-retry'));
  await act(async () => { finish(); });
  await waitFor(() => expect(modal().props.visible).toBe(false));
  expect(activeRows()).toHaveLength(1);
});
