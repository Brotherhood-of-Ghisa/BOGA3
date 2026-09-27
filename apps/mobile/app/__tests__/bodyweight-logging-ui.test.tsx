import { fireEvent, render, screen } from '@testing-library/react-native';
import { SetLogger } from '@/components/exercise-page/set-logger';
import { addSet, commitSet, displayedValues, updateLoggerValues } from '@/src/session-recorder/exercise-page-model';

const context = { bodyweightCoefficient: 1, bodyWeightKg: 80, loadInputMode: 'total_load' };
const props = { number: 1, weightValue: '20', repsValue: '8', setType: null,
  onChangeWeight: jest.fn(), onChangeReps: jest.fn(), onCycleEffort: jest.fn(), onOpenEffort: jest.fn(), onCommit: jest.fn(),
  onChangeLoad: jest.fn(), weightUnit: 'kg', externalLoadMode: 'added', loadContext: context };
beforeEach(() => jest.clearAllMocks());

it.each([null, 'added', 'assistance', 'unquantified_assistance'])('treats saved numeric values as added weight, including old mode %s', externalLoadMode => {
  render(<SetLogger {...props} externalLoadMode={externalLoadMode} />);
  expect(screen.getByTestId('exercise-set-logger-preview').props.children).toBe('Added 1RM 47.7 · VOL 800');
  expect(screen.getByText('Added · kg')).toBeTruthy();
  expect(screen.getByLabelText('Set 1 added weight in kg')).toBeTruthy();
  expect(screen.queryByText('Assisted')).toBeNull();
  expect(screen.queryByText('Unquantified')).toBeNull();
  expect(screen.queryByText('Review original loads')).toBeNull();
  expect(screen.getByTestId('exercise-set-logger-weight').props.value).toBe('20');
  fireEvent.press(screen.getByTestId('exercise-set-unit-lb'));
  expect(props.onChangeLoad).toHaveBeenCalledWith({ weightUnit: 'lb' });
  fireEvent.press(screen.getByTestId('exercise-set-logger-commit'));
  expect(props.onCommit).toHaveBeenCalledTimes(1);
});

it('keeps the unit selector read-only until unknown saved units hydrate', () => {
  render(<SetLogger {...props} unitEditable={false} />);
  expect(screen.getByText('Sync to change units.')).toBeTruthy();
  expect(screen.getByTestId('exercise-set-unit-lb').props.accessibilityState.disabled).toBe(true);
});

it('permits confirmed reps with missing body weight without showing a fake load score', () => {
  render(<SetLogger {...props} loadContext={{ ...context, bodyWeightKg: null }} />);
  expect(screen.getByText('Unavailable · session weight missing.')).toBeTruthy();
  expect(screen.getByTestId('exercise-set-logger-preview').props.children).toBe('Added 1RM — · VOL —');
  fireEvent.press(screen.getByTestId('exercise-set-logger-commit'));
  expect(props.onCommit).toHaveBeenCalledTimes(1);
});

it('retains planned values and units while confirming and copying added weight', () => {
  const plan = { id: 'p', weightValue: '', repsValue: '', setType: null, weightUnit: 'kg', externalLoadMode: null,
    plannedWeightValue: '40', plannedWeightUnit: 'lb', plannedExternalLoadMode: 'assistance',
    plannedRepsValue: '8', plannedSetType: 'rir_1' as const, performanceStatus: 'planned' as const, localBodyweightMetadataKnown: true };
  const [typed] = updateLoggerValues([plan], 'p', { repsValue: '7' });
  expect(typed).toMatchObject({ weightValue: '40', weightUnit: 'lb', externalLoadMode: 'added', performanceStatus: 'planned' });
  const [done] = commitSet([typed], 'p', displayedValues(typed));
  expect(done).toMatchObject({ weightUnit: 'lb', externalLoadMode: 'added', performanceStatus: null,
    plannedWeightValue: '40', plannedExternalLoadMode: 'assistance' });
  expect(addSet([done], 'copy')[1]).toMatchObject({ weightValue: '40', weightUnit: 'lb', externalLoadMode: 'added', performanceStatus: 'unperformed' });
});
