import { fireEvent, render, screen } from '@testing-library/react-native';
import { GroupComparisonForm } from '@/components/groups/group-comparison-form';
import type { GroupMetricExerciseWire } from '@/src/groups/metric-wire';

const existing: GroupMetricExerciseWire = {
  group_exercise_id: 'exercise', name: 'Pull-up', load_input_mode: 'total_load', source_exercise_id: null,
  bodyweight_calculations_enabled: true, bodyweight_contribution: 1, default_metric: 'e1rm',
  rules_revision: 2, published_revision: 2, rebuilding: false, archived_at_ms: null, legacy: false,
};
const props = { existing, bodyweightCalculationsEnabled: true,
  submitLabel: 'Save changes', pendingLabel: 'Saving…', pending: false, errorMessage: null };

describe('group comparison rule editor', () => {
  it('reviews a calculation change before submitting the rules and original revision', () => {
    const onSubmit = jest.fn();
    render(<GroupComparisonForm {...props} onSubmit={onSubmit} />);
    fireEvent.changeText(screen.getByTestId('group-exercise-form-bodyweight-percentage'), '70');
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-rules-preview')).toHaveTextContent(/100% → 70%/);
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ bodyweightContribution: 0.7, defaultMetric: 'e1rm' }), 2);
  });
  it('invalidates the preview when any input changes before Apply', () => {
    const onSubmit = jest.fn();
    render(<GroupComparisonForm {...props} onSubmit={onSubmit} />);
    fireEvent.changeText(screen.getByTestId('group-exercise-form-bodyweight-percentage'), '70');
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    fireEvent.changeText(screen.getByTestId('group-exercise-form-bodyweight-percentage'), '80');
    expect(screen.queryByTestId('group-rules-preview')).toBeNull();
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-rules-preview')).toHaveTextContent(/100% → 80%/);
  });
  it('allows a name/default-view change without promising a calculation revision', () => {
    const onSubmit = jest.fn();
    render(<GroupComparisonForm {...props} onSubmit={onSubmit} />);
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), 'Pull-ups');
    fireEvent.press(screen.getByTestId('group-exercise-default-metric-weight'));
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Pull-ups', defaultMetric: 'weight' }), 2);
    expect(screen.queryByTestId('group-rules-preview')).toBeNull();
  });
  it('keeps dirty inputs when a fresher revision arrives until explicit Reload', () => {
    const onSubmit = jest.fn();
    const { rerender } = render(<GroupComparisonForm {...props} onSubmit={onSubmit} />);
    fireEvent.changeText(screen.getByTestId('group-exercise-form-bodyweight-percentage'), '70');
    rerender(<GroupComparisonForm {...props} existing={{ ...existing, bodyweight_contribution: 0.8, rules_revision: 3, published_revision: 3 }} onSubmit={onSubmit} />);
    expect(screen.getByTestId('group-exercise-form-bodyweight-percentage')).toHaveProp('value', '70');
    expect(screen.getByTestId('group-rules-stale')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('group-rules-reload'));
    expect(screen.getByTestId('group-exercise-form-bodyweight-percentage')).toHaveProp('value', '80');
    expect(screen.queryByTestId('group-rules-stale')).toBeNull();
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ bodyweightContribution: 0.8 }), 3);
  });
  it('shows original certification coverage when activating a legacy comparison', () => {
    render(<GroupComparisonForm {...props} existing={{ ...existing, legacy: true, bodyweight_contribution: 0 }} onSubmit={jest.fn()} />);
    fireEvent.changeText(screen.getByTestId('group-exercise-form-bodyweight-percentage'), '100');
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(screen.getByText(/Existing certifications keep their original coverage/)).toBeOnTheScreen();
  });
  it('retains values and the inline failure for a retry, and disables pending writes', () => {
    const onSubmit = jest.fn();
    const { rerender } = render(<GroupComparisonForm {...props} onSubmit={onSubmit} />);
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), 'My label');
    rerender(<GroupComparisonForm {...props} errorMessage="You're offline. Nothing was changed." onSubmit={onSubmit} />);
    expect(screen.getByTestId('group-exercise-form-name-input')).toHaveProp('value', 'My label');
    expect(screen.getByTestId('group-exercise-form-error')).toHaveTextContent(/Nothing was changed/);
    rerender(<GroupComparisonForm {...props} pending onSubmit={onSubmit} />);
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
