import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ExerciseMergeReviewScreen } from '@/components/sync-status/exercise-merge-review';
import { launchTheme } from '@/components/ui/theme-launch';
import { rolesFor } from './helpers/theme';
import type { MergeReviewItem } from '@/src/exercise-core/merge-types';

const roles = rolesFor(launchTheme.appearance);

const mockLoad = jest.fn();
const mockResolve = jest.fn();
const mockRecover = jest.fn();
jest.mock('@/src/exercise-catalog/merge', () => ({
  loadMergeReview: () => mockLoad(),
  resolveMergeReview: (...args: unknown[]) => mockResolve(...args),
  recoverExerciseMerge: () => mockRecover(),
}));
const item: MergeReviewItem = { id: 'saved', type: 'exercise_sets', entityId: 'set', blockId: 'block', sessionId: 'session',
  exerciseName: 'Destination', token: 'old', invalid: false, sessionStartedAt: 100,
  current: { weight_value: '20', planned_set_type: 'warm_up', deleted_at: null },
  saved: { weight_value: '25', planned_set_type: 'rir_2', deleted_at: 200 } };
const review = (overrides: object = {}) => ({ items: [item], pending: 0, operation: false, error: null, ...overrides });
const confirmAlert = () => {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  act(() => buttons.find(button => button.text === 'Apply')?.onPress?.());
};
beforeEach(() => {
  mockLoad.mockReset().mockResolvedValue(review());
  mockResolve.mockReset().mockResolvedValue(undefined);
  mockRecover.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('shows each changed field as a value row, current then saved, under the exercise name', async () => {
  render(<ExerciseMergeReviewScreen />);
  expect(await screen.findByLabelText('Planned effort: current W-Up, saved RIR 2')).toBeTruthy();
  expect(screen.getByLabelText('Weight: current 20, saved 25')).toBeTruthy();
  expect(screen.getByLabelText('History: current Kept, saved Removed')).toBeTruthy();
  expect(screen.getByText('Destination')).toBeTruthy();
  expect(screen.getByText('Apply saved removal')).toHaveStyle({ color: roles.danger });
  expect(screen.getByText('Keep current history')).toHaveStyle({ color: roles.accent });
});

it('confirms a saved removal in an Alert and retains refreshed review after a race', async () => {
  render(<ExerciseMergeReviewScreen />);
  await screen.findByText('Apply saved removal');
  mockLoad.mockResolvedValue(review({ items: [{ ...item, token: 'new', current: { ...item.current, weight_value: '24' } }] }));
  mockResolve.mockRejectedValueOnce(new Error('MERGE_STALE: changed'));
  fireEvent.press(screen.getByText('Apply saved removal'));
  expect(Alert.alert).toHaveBeenCalledWith('Apply saved removal?', expect.any(String), expect.any(Array));
  expect(mockResolve).not.toHaveBeenCalled();
  confirmAlert();
  await screen.findByText('History changed on another device. Review the refreshed values before applying.');
  expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({ token: 'old' }), false);
  expect(screen.getByLabelText('Weight: current 24, saved 25')).toBeTruthy();
  fireEvent.press(screen.getByText('Keep current history'));
  await waitFor(() => expect(mockResolve).toHaveBeenLastCalledWith(expect.objectContaining({ token: 'new' }), true));
});

it('applies saved changes that remove nothing straight away', async () => {
  mockLoad.mockResolvedValueOnce(review({ items: [{ ...item, saved: { ...item.saved, deleted_at: null } }] }))
    .mockResolvedValue(review({ items: [] }));
  render(<ExerciseMergeReviewScreen />);
  fireEvent.press(await screen.findByText('Apply saved changes'));
  expect(Alert.alert).not.toHaveBeenCalled();
  await screen.findByText('No changes need review.');
  expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({ id: 'saved' }), false);
});

it('retains invalid saved values for reading while permitting only Keep current', async () => {
  mockLoad.mockResolvedValue(review({ items: [{ ...item, invalid: true }] }));
  render(<ExerciseMergeReviewScreen />);
  await screen.findByText('These saved values need correction before they can be applied.');
  expect(screen.getByTestId('exercise-merge-apply-saved')).toBeDisabled();
  expect(screen.getByTestId('exercise-merge-keep-saved')).not.toBeDisabled();
});

it('shows saved workout metadata alongside the current lifecycle and explains that Apply keeps it finished', async () => {
  mockLoad.mockResolvedValue(review({ items: [{ ...item, type: 'sessions', exerciseName: 'Workout',
    current: { status: 'completed', gym_id: 'home', gym_name: 'Home', started_at: 100, completed_at: 200, deleted_at: null },
    saved: { status: 'completed', gym_id: 'gym', gym_name: 'Gym', started_at: 100, completed_at: 200, deleted_at: null },
  }] }));
  render(<ExerciseMergeReviewScreen />);
  expect(await screen.findByLabelText('Gym: current Home, saved Gym')).toBeTruthy();
  expect(screen.getByText('Finished')).toBeTruthy();
  expect(screen.getByText('Applying saved metadata keeps this workout finished.')).toBeTruthy();
  expect(screen.getByTestId('exercise-merge-apply-saved')).not.toBeDisabled();
});

it('explains that an absent exercise must be applied before its saved sets', async () => {
  mockLoad.mockResolvedValue(review({ items: [{ ...item, invalid: true, current: null,
    notice: 'Apply the saved exercise before applying its sets or tags.' }] }));
  render(<ExerciseMergeReviewScreen />);
  expect(await screen.findByText('Apply the saved exercise before applying its sets or tags.')).toBeTruthy();
  expect(screen.getByTestId('exercise-merge-apply-saved')).toBeDisabled();
  expect(screen.getByTestId('exercise-merge-keep-saved')).not.toBeDisabled();
});

it('shows exact timing differences when both instants fall within the same displayed minute', async () => {
  mockLoad.mockResolvedValue(review({ items: [{ ...item, type: 'sessions', exerciseName: 'Workout',
    current: { status: 'completed', started_at: 1000, completed_at: 100000, deleted_at: null },
    saved: { status: 'completed', started_at: 2000, completed_at: 100000, deleted_at: null },
  }] }));
  render(<ExerciseMergeReviewScreen />);
  expect(await screen.findByLabelText(/Start: current .*:01\.000, saved .*:02\.000/)).toBeTruthy();
});

it('keeps a lifecycle-only saved state visible without offering a metadata apply that changes nothing', async () => {
  mockLoad.mockResolvedValue(review({ items: [{ ...item, type: 'sessions', exerciseName: 'Workout',
    current: { status: 'completed', deleted_at: null }, saved: { status: 'completed', deleted_at: null },
  }] }));
  render(<ExerciseMergeReviewScreen />);
  expect(await screen.findByText('No metadata changes need applying. Reopen or restore the workout in the app.')).toBeTruthy();
  expect(screen.getByTestId('exercise-merge-apply-saved')).toBeDisabled();
  expect(screen.getByTestId('exercise-merge-keep-saved')).not.toBeDisabled();
});

it('keeps a real assignment between identically named gyms distinguishable and applicable', async () => {
  mockLoad.mockResolvedValue(review({ items: [{ ...item, type: 'sessions', exerciseName: 'Workout',
    current: { status: 'completed', gym_id: 'gym-a', gym_name: 'North End', deleted_at: null },
    saved: { status: 'completed', gym_id: 'gym-b', gym_name: 'North End', deleted_at: null },
  }] }));
  render(<ExerciseMergeReviewScreen />);
  expect(await screen.findByLabelText('Gym: current North End, saved North End (different gym)')).toBeTruthy();
  expect(screen.getByTestId('exercise-merge-apply-saved')).not.toBeDisabled();
});

it('describes an absent current set without NaN or undefined values', async () => {
  mockLoad.mockResolvedValue(review({ items: [{ ...item, current: null, sessionStartedAt: null,
    saved: { weight_value: '25', order_index: 0, performance_status: null, deleted_at: null } }] }));
  render(<ExerciseMergeReviewScreen />);
  expect(await screen.findByLabelText('Position: current Empty, saved 1')).toBeTruthy();
  expect(screen.getByLabelText('State: current Empty, saved Performed')).toBeTruthy();
  expect(screen.getByLabelText('History: current Absent, saved Kept')).toBeTruthy();
  expect(screen.queryByText('Session')).toBeNull();
});

it('shows a load failure and pending changes as Notices whose Retry reloads', async () => {
  mockLoad.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(review({ items: [], pending: 2 }))
    .mockResolvedValue(review({ items: [] }));
  render(<ExerciseMergeReviewScreen />);
  expect(await screen.findByText('offline')).toBeTruthy();
  fireEvent.press(screen.getByText('Retry'));
  expect(await screen.findByText('Saved changes are waiting to sync.')).toBeTruthy();
  expect(screen.queryByText('offline')).toBeNull();
  fireEvent.press(screen.getByText('Retry'));
  expect(await screen.findByText('No changes need review.')).toBeTruthy();
});

it('checks an uncertain merge from an action row and reports its failure', async () => {
  mockLoad.mockResolvedValue(review({ items: [], operation: true }));
  mockRecover.mockRejectedValueOnce(new Error('Merge still running.')).mockResolvedValue(undefined);
  render(<ExerciseMergeReviewScreen />);
  fireEvent.press(await screen.findByText('Check merge result'));
  expect(await screen.findByText('Merge still running.')).toBeTruthy();
  fireEvent.press(screen.getByText('Check merge result'));
  await waitFor(() => expect(mockRecover).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
});
