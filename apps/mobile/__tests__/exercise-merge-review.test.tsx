import { fireEvent, render, screen } from '@testing-library/react-native';
import { ExerciseMergeReview } from '@/components/sync-status/exercise-merge-review';
import { uiFonts } from '@/components/ui';
import type { MergeReviewItem } from '@/src/exercise-core/merge-types';

const mockLoad = jest.fn();
const mockResolve = jest.fn();
jest.mock('@/src/exercise-catalog/merge', () => ({
  loadMergeReview: () => mockLoad(),
  resolveMergeReview: (...args: unknown[]) => mockResolve(...args),
  recoverExerciseMerge: jest.fn(),
}));
const item: MergeReviewItem = { id: 'saved', type: 'exercise_sets', entityId: 'set', blockId: 'block', sessionId: 'session',
  exerciseName: 'Destination', token: 'old', invalid: false, sessionStartedAt: 100,
  current: { weight_value: '20', planned_set_type: 'warm_up', deleted_at: null },
  saved: { weight_value: '25', planned_set_type: 'rir_2', deleted_at: 200 } };
beforeEach(() => {
  mockLoad.mockReset().mockResolvedValue({ items: [item], pending: 0, operation: false, error: null });
  mockResolve.mockReset().mockResolvedValue(undefined);
});
it('shows planned effort and explicit removal beside current values and retains refreshed review after a race', async () => {
  render(<ExerciseMergeReview visible onDismiss={jest.fn()} onChanged={jest.fn()} />);
  await screen.findByText('Planned effort');
  expect(screen.getByText('RIR 2')).toBeTruthy();
  expect(screen.getByText('25')).toHaveStyle({ fontFamily: uiFonts.figure.family });
  expect(screen.getByText('W-Up')).toBeTruthy();
  expect(screen.getByText('Removed')).toBeTruthy();
  mockLoad.mockResolvedValue({ items: [{ ...item, token: 'new', current: { ...item.current, weight_value: '24' } }],
    pending: 0, operation: false, error: null });
  mockResolve.mockRejectedValueOnce(new Error('MERGE_STALE: changed'));
  fireEvent.press(screen.getByText('Apply saved removal'));
  await screen.findByText('History changed on another device. Review the refreshed values before applying.');
  expect(screen.getByText('24')).toBeTruthy();
  fireEvent.press(screen.getByText('Keep current history'));
  await screen.findByText('Apply saved removal');
  expect(mockResolve).toHaveBeenLastCalledWith(expect.objectContaining({ token: 'new' }), true);
});
it('retains invalid saved values for reading while permitting only Keep current', async () => {
  mockLoad.mockResolvedValue({ items: [{ ...item, invalid: true }], pending: 0, operation: false, error: null });
  render(<ExerciseMergeReview visible onDismiss={jest.fn()} onChanged={jest.fn()} />);
  await screen.findByText('These saved values need correction before they can be applied.');
  expect(screen.getByTestId('exercise-merge-apply-saved')).toBeDisabled();
  expect(screen.getByTestId('exercise-merge-keep-saved')).not.toBeDisabled();
});
