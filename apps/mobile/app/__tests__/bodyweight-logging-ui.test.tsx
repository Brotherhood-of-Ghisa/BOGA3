import { fireEvent, render, screen } from '@testing-library/react-native';
import { SetLogger } from '@/components/exercise-page/set-logger';
import { SetSummaryRow } from '@/components/session-detail/set-summary-row';
import { addSet, commitSet, displayedValues, updateLoggerValues } from '@/src/session-recorder/exercise-page-model';
import { formatSetRow } from '@/src/session-recorder/session-view-model';

const context = { policy: 'personal' as const, bodyweightContribution: 1,
  bodyWeightKg: 80, loadInputMode: 'total_load' as const };
const props = { number: 1, weightValue: '20', repsValue: '8', setType: null,
  onChangeWeight: jest.fn(), onChangeReps: jest.fn(), onCycleEffort: jest.fn(),
  onOpenEffort: jest.fn(), onCommit: jest.fn(), loadContext: context };
beforeEach(() => jest.clearAllMocks());

it('uses one ordinary kg Weight field while bodyweight changes only the preview math', () => {
  render(<SetLogger {...props} />);
  expect(screen.getByTestId('exercise-set-logger-preview').props.children).toBe('1RM 47.7 · VOL 800');
  expect(screen.getByText('Weight · kg')).toBeTruthy();
  expect(screen.getByLabelText('Set 1 weight in kilograms')).toBeTruthy();
  expect(screen.queryByText(/Added|External|Effective load|session weight missing/i)).toBeNull();
  expect(screen.getByTestId('exercise-set-logger-weight').props.value).toBe('20');
  fireEvent.press(screen.getByTestId('exercise-set-logger-commit'));
  expect(props.onCommit).toHaveBeenCalledTimes(1);
});

it('uses the personal zero fallback without a warning when no reading applies', () => {
  render(<SetLogger {...props} loadContext={{ ...context, bodyWeightKg: null }} />);
  expect(screen.queryByText(/Unavailable|missing|body weight/i)).toBeNull();
  expect(screen.getByTestId('exercise-set-logger-preview').props.children).toBe('1RM 25.5 · VOL 160');
  fireEvent.press(screen.getByTestId('exercise-set-logger-commit'));
  expect(props.onCommit).toHaveBeenCalledTimes(1);
});

it('renders the ordinary set-row layout and copy while bodyweight changes only the math', () => {
  const ordinary = formatSetRow({ id: 'ordinary', weight: 0, reps: 10, setType: null, done: true });
  const aware = formatSetRow({ id: 'aware', weight: 0, reps: 10, setType: null, done: true, loadContext: context });
  render(<>
    <SetSummaryRow row={ordinary} testID="ordinary-row" />
    <SetSummaryRow row={aware} testID="aware-row" />
  </>);

  expect(ordinary).toMatchObject({ weightReps: '0.0 × 10', volume: '0' });
  expect(aware).toMatchObject({ weightReps: '0.0 × 10', volume: '800' });
  expect(screen.getByTestId('aware-row').props.style).toEqual(screen.getByTestId('ordinary-row').props.style);
  expect(screen.getByTestId('aware-row-values')).toHaveTextContent('0.0 × 10');
  expect(screen.getByTestId('aware-row-1rm').props.accessibilityLabel).toMatch(/^1RM /);
  expect(screen.queryByText(/Added 1RM|BW \+|Effective load/i)).toBeNull();
});

it('retains planned kg values while confirming and copying a set', () => {
  const plan = { id: 'planned', weightValue: '', repsValue: '', setType: null,
    plannedWeightValue: '40', plannedRepsValue: '8', plannedSetType: 'rir_1' as const,
    performanceStatus: 'planned' as const };
  const [typed] = updateLoggerValues([plan], 'planned', { repsValue: '7' });
  expect(typed).toMatchObject({ weightValue: '40', repsValue: '7', performanceStatus: 'planned' });
  const [done] = commitSet([typed], 'planned', displayedValues(typed));
  expect(done).toMatchObject({ weightValue: '40', repsValue: '7', performanceStatus: null,
    plannedWeightValue: '40', plannedRepsValue: '8' });
  expect(addSet([done], 'copy')[1]).toMatchObject({ weightValue: '40', repsValue: '7',
    performanceStatus: 'unperformed' });
});
