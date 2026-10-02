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
  it('rejects a contribution over 100% inline, with no preview and no submit', () => {
    const onSubmit = jest.fn();
    render(<GroupComparisonForm {...props} onSubmit={onSubmit} />);
    fireEvent.changeText(screen.getByTestId('group-exercise-form-bodyweight-percentage'), '101');
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(screen.getByTestId('group-exercise-form-bodyweight-error')).toHaveTextContent(
      'Bodyweight contribution must be from 0% to 100%.'
    );
    expect(screen.queryByTestId('group-rules-preview')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
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

describe('group comparison rule editor: creating and edge inputs', () => {
  const createProps = { bodyweightCalculationsEnabled: true, submitLabel: 'Create comparison', pendingLabel: 'Creating…', pending: false, errorMessage: null };

  it('creates from blank rules: no revision, no review step, and the group setting for bodyweight', () => {
    const onSubmit = jest.fn();
    render(<GroupComparisonForm {...createProps} onSubmit={onSubmit} />);
    expect(screen.queryByTestId('group-rules-revision')).toBeNull();
    expect(screen.getByTestId('group-exercise-form-name-input')).toHaveProp('value', '');
    expect(screen.getByTestId('group-exercise-form-bodyweight-percentage')).toHaveProp('value', '0');
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), 'Dips');
    fireEvent.changeText(screen.getByTestId('group-exercise-form-bodyweight-percentage'), '90');
    expect(screen.getByTestId('group-exercise-form-submit')).toHaveTextContent('Create comparison');
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Dips', loadInputMode: 'total_load', bodyweightCalculationsEnabled: true,
      bodyweightContribution: 0.9, defaultMetric: 'e1rm',
    }, null);
  });

  it('starts from prefilled rules and follows a new prefill until edited', () => {
    const initialRules = { name: 'Bench', loadInputMode: 'total_load' as const, bodyweightCalculationsEnabled: false,
      bodyweightContribution: 0, defaultMetric: 'weight' as const };
    const { rerender } = render(<GroupComparisonForm {...createProps} initialRules={initialRules} onSubmit={jest.fn()} />);
    expect(screen.getByTestId('group-exercise-form-name-input')).toHaveProp('value', 'Bench');
    rerender(<GroupComparisonForm {...createProps} initialRules={{ ...initialRules, name: 'Incline bench' }} onSubmit={jest.fn()} />);
    expect(screen.getByTestId('group-exercise-form-name-input')).toHaveProp('value', 'Incline bench');
    expect(screen.queryByTestId('group-rules-revision')).toBeNull();
  });

  it('shows the note and the current revision', () => {
    render(<GroupComparisonForm {...props} note="Linked from your exercise." onSubmit={jest.fn()} />);
    expect(screen.getByTestId('group-exercise-form-note')).toHaveTextContent('Linked from your exercise.');
    expect(screen.getByTestId('group-rules-revision')).toHaveTextContent('Rules revision 2');
  });

  it('names a missing name inline, without the contribution error', () => {
    const onSubmit = jest.fn();
    render(<GroupComparisonForm {...props} onSubmit={onSubmit} />);
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), '   ');
    expect(screen.queryByTestId('group-exercise-form-name-error')).toBeNull();
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(screen.getByTestId('group-exercise-form-name-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('group-exercise-form-bodyweight-error')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects an empty contribution', () => {
    const onSubmit = jest.fn();
    render(<GroupComparisonForm {...props} onSubmit={onSubmit} />);
    fireEvent.changeText(screen.getByTestId('group-exercise-form-bodyweight-percentage'), ' ');
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(screen.getByTestId('group-exercise-form-bodyweight-error')).toBeOnTheScreen();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('accepts a decimal comma in the contribution', () => {
    const onSubmit = jest.fn();
    render(<GroupComparisonForm {...props} onSubmit={onSubmit} />);
    fireEvent.changeText(screen.getByTestId('group-exercise-form-bodyweight-percentage'), '62,5');
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ bodyweightContribution: 0.625 }), 2);
  });

  it('hides the contribution field when the group has bodyweight calculations off', () => {
    render(<GroupComparisonForm {...createProps} bodyweightCalculationsEnabled={false} onSubmit={jest.fn()} />);
    expect(screen.queryByTestId('group-exercise-form-bodyweight-percentage')).toBeNull();
  });

  it('reviews a load-mode change with per-side wording, and labels each step', () => {
    const onSubmit = jest.fn();
    render(<GroupComparisonForm {...props} onSubmit={onSubmit} />);
    fireEvent.press(screen.getByTestId('group-exercise-form-load-mode-per_side_load'));
    expect(screen.getByTestId('group-exercise-form-submit')).toHaveTextContent('Review rule changes');
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(screen.getByTestId('group-rules-preview')).toHaveTextContent(
      'Apply rules revision 3: 100% → 100% bodyweight contribution, per-side Weight. The whole board will rebuild together. ' +
        'Previous scores stay in their original rules history; this is not a new performed record.',
    );
    expect(screen.getByText(/Attestations of unchanged performance inputs stay valid/)).toBeOnTheScreen();
    expect(screen.getByTestId('group-exercise-form-submit')).toHaveTextContent('Apply group rules');
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ loadInputMode: 'per_side_load' }), 2);
  });

  it('shows the pending label while saving', () => {
    render(<GroupComparisonForm {...props} pending onSubmit={jest.fn()} />);
    expect(screen.getByTestId('group-exercise-form-submit')).toHaveTextContent('Saving…');
  });
});
