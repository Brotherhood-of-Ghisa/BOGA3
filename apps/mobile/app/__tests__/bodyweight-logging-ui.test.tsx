import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { LegacyLoadReviewSheet } from '@/components/bodyweight/legacy-load-review-sheet';
import { SetLogger } from '@/components/exercise-page/set-logger';
import { addSet, commitSet, displayedValues, updateLoggerValues } from '@/src/session-recorder/exercise-page-model';
import type { LegacyLoadInventory } from '@/src/data/legacy-load-review';

jest.mock('@/src/data/legacy-load-review', () => ({
  listLegacyLoads: jest.fn(), applyLegacyLoadReview: jest.fn(),
  previewLegacyLoads: jest.fn((inventory, selections) => ({ exerciseId: inventory.exerciseId,
    fingerprint: inventory.fingerprint, selections, rows: selections.map(({ key, choice }: { key: string; choice: never }) => {
      const original = inventory.candidates.find((row: { key: string }) => row.key === key);
      return { original, reviewed: jest.requireActual('@/src/bodyweight/legacy-load').reviewLegacyLoad(original, { bodyweightCoefficient: 1, bodyWeightKg: original.bodyWeightKg, loadInputMode: 'total_load' }, choice) };
    }) })),
}));
const data = jest.requireMock('@/src/data/legacy-load-review') as Record<string, jest.Mock>;
const context = { bodyweightCoefficient: 1, bodyWeightKg: 80, loadInputMode: 'total_load' };
const props = { number: 1, weightValue: '20', repsValue: '8', setType: null,
  onChangeWeight: jest.fn(), onChangeReps: jest.fn(), onCycleEffort: jest.fn(), onOpenEffort: jest.fn(), onCommit: jest.fn(),
  onChangeLoad: jest.fn(), weightUnit: 'kg', externalLoadMode: 'added', loadContext: context };
const inventory: LegacyLoadInventory = { exerciseId: 'pull', exerciseName: 'Pull-up', fingerprint: 'v1',
  bodyweightCoefficient: 1, loadInputMode: 'total_load', metadataKnown: true, candidates: [{
    key: 'set:actual', setId: 'set', part: 'actual', sessionId: 'session', startedAt: new Date('2026-01-01T12:00:00Z'),
    setNumber: 1, weightValue: '100', repsValue: '8', storedUnit: 'kg', bodyWeightKg: 80,
    bodyWeightSource: 'historical_estimate', bodyWeightMeasurementId: 'reading', bodyWeightMeasuredAt: new Date('2026-01-10T12:00:00Z'), metadataKnown: true,
  }] };

beforeEach(() => { jest.clearAllMocks(); data.listLegacyLoads.mockResolvedValue(inventory); data.applyLegacyLoadReview.mockResolvedValue(1); });

it('shows total resistance while added/assisted input stays positive and explicitly unit-labelled', () => {
  const view = render(<SetLogger {...props} />);
  expect(screen.getByTestId('exercise-set-logger-preview').props.children).toBe('1RM 127.7 · VOL 800');
  expect(screen.getByText('Added weight · kg')).toBeTruthy();
  fireEvent.press(screen.getByTestId('exercise-set-load-mode-assistance'));
  expect(props.onChangeLoad).toHaveBeenCalledWith({ externalLoadMode: 'assistance' });
  view.rerender(<SetLogger {...props} externalLoadMode="assistance" />);
  expect(screen.getByTestId('exercise-set-logger-preview').props.children).toBe('1RM 76.6 · VOL 480');
  expect(screen.getByTestId('exercise-set-logger-weight').props.value).toBe('20');
  fireEvent.press(screen.getByTestId('exercise-set-unit-lb'));
  expect(props.onChangeLoad).toHaveBeenCalledWith({ weightUnit: 'lb' });
});

it('permits confirmed reps with missing B or unquantified assistance without showing a fake load score', () => {
  const view = render(<SetLogger {...props} loadContext={{ ...context, bodyWeightKg: null }} />);
  expect(screen.getByText('Unavailable · session weight missing.')).toBeTruthy();
  expect(screen.getByTestId('exercise-set-logger-preview').props.children).toBe('1RM — · VOL —');
  fireEvent.press(screen.getByTestId('exercise-set-logger-commit'));
  expect(props.onCommit).toHaveBeenCalledTimes(1);
  view.rerender(<SetLogger {...props} weightValue="" externalLoadMode="unquantified_assistance" />);
  expect(screen.getByTestId('exercise-set-logger-weight').props.editable).toBe(false);
  expect(screen.getByTestId('exercise-set-logger-preview').props.children).toBe('1RM — · VOL —');
  fireEvent.press(screen.getByTestId('exercise-set-logger-commit'));
  expect(props.onCommit).toHaveBeenCalledTimes(2);
});

it('keeps a legacy zero unresolved and offers explicit review before activating it', () => {
  const review = jest.fn();
  render(<SetLogger {...props} externalLoadMode={null} weightValue="0" requiresReview onReview={review} />);
  fireEvent.press(screen.getByTestId('exercise-set-logger-commit'));
  expect(props.onCommit).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('exercise-set-review-load'));
  expect(review).toHaveBeenCalledTimes(1);
});

it('keeps planned unit/mode while typing, explicitly confirming and copying a row', () => {
  const plan = { id: 'p', weightValue: '', repsValue: '', setType: null, weightUnit: 'kg', externalLoadMode: null,
    plannedWeightValue: '40', plannedWeightUnit: 'lb', plannedExternalLoadMode: 'assistance',
    plannedRepsValue: '8', plannedSetType: 'rir_1' as const, performanceStatus: 'planned' as const, localBodyweightMetadataKnown: true };
  const [typed] = updateLoggerValues([plan], 'p', { repsValue: '7' });
  expect(typed).toMatchObject({ weightValue: '40', weightUnit: 'lb', externalLoadMode: 'assistance', performanceStatus: 'planned' });
  const [done] = commitSet([typed], 'p', displayedValues(typed));
  expect(done).toMatchObject({ weightUnit: 'lb', externalLoadMode: 'assistance', performanceStatus: null, plannedExternalLoadMode: 'assistance' });
  const copy = addSet([done], 'copy')[1];
  expect(copy).toMatchObject({ weightUnit: 'lb', externalLoadMode: 'assistance', performanceStatus: 'unperformed' });
});

it('requires source unit, shows originals and conversion, and writes only after Apply', async () => {
  render(<LegacyLoadReviewSheet exerciseId="pull" visible onDismiss={jest.fn()} />);
  fireEvent.press(await screen.findByTestId('legacy-load-select-set:actual'));
  fireEvent.press(screen.getByTestId('legacy-load-meaning-total'));
  fireEvent.press(screen.getByTestId('legacy-load-preview'));
  expect(screen.getByTestId('legacy-load-error')).toBeTruthy();
  expect(data.previewLegacyLoads).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('legacy-load-unit-kg'));
  fireEvent.press(screen.getByTestId('legacy-load-preview'));
  expect(screen.getByText('Original: 100 kg × 8')).toBeTruthy();
  expect(screen.getByText(/Added: 20 kg · Effective load 100 kg/)).toBeTruthy();
  expect(screen.getByText(/Estimated from/)).toBeTruthy();
  expect(data.applyLegacyLoadReview).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('legacy-load-apply'));
  await screen.findByTestId('legacy-load-result');
  expect(data.applyLegacyLoadReview).toHaveBeenCalledTimes(1);
});

it('leaves a failed/stale preview visible and cancellation makes no conversion', async () => {
  data.applyLegacyLoadReview.mockRejectedValue(new Error('The session changed. Refresh the preview.'));
  const dismiss = jest.fn();
  render(<LegacyLoadReviewSheet exerciseId="pull" visible onDismiss={dismiss} />);
  fireEvent.press(await screen.findByTestId('legacy-load-select-set:actual'));
  fireEvent.press(screen.getByTestId('legacy-load-meaning-total'));
  fireEvent.press(screen.getByTestId('legacy-load-unit-kg'));
  fireEvent.press(screen.getByTestId('legacy-load-preview'));
  fireEvent.press(screen.getByTestId('legacy-load-apply'));
  await screen.findByText('The session changed. Refresh the preview.');
  expect(screen.getByText('Original: 100 kg × 8')).toBeTruthy();
  fireEvent.press(screen.getByTestId('legacy-load-cancel'));
  await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1));
  expect(data.applyLegacyLoadReview).toHaveBeenCalledTimes(1);
});
