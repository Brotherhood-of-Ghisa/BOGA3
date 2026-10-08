import { fireEvent, render, screen } from '@testing-library/react-native';

import { ExerciseVolumeCard } from '@/components/session-complete/exercise-volume-card';
import { uiRoles } from '@/components/ui/tokens';
import type { ExerciseVolumeComparison } from '@/src/session-insights';

const comparison: ExerciseVolumeComparison = {
  exerciseDefinitionId: 'bench', exerciseName: 'Bench Press', sessionExerciseIds: ['bench'], sessionExerciseOrderIndex: 0,
  workingSetCount: 2, currentVolume: 500, historicalSessionCount: 0,
  medianVolume: null, percentile25Volume: null, percentile75Volume: null, state: 'no-history',
};

// An overflowed sum is dashed, never explained ([[copy.no-inline-explanation]]).
it('dashes an unavailable Volume with no note and no comparison line', () => {
  render(<ExerciseVolumeCard comparison={{ ...comparison, currentVolume: null, state: 'unavailable' }} testID="card" />);
  expect(screen.getByText('Vol')).toBeTruthy();
  expect(screen.getAllByText('—')).toHaveLength(1);
  expect(screen.queryByText(/Known vol|Missing load|excluded|incomplete|first comparable/i)).toBeNull();
  expect(screen.getByLabelText('Bench Press, 2 sets. Session volume unavailable.')).toBeTruthy();
});

it.each([0, 1, 2, 3, 4, 5])('shows Building history with %i prior observations and keeps sets beside the name', count => {
  render(<ExerciseVolumeCard comparison={{ ...comparison, historicalSessionCount: count,
    medianVolume: count ? 400 : null, percentile25Volume: count ? 300 : null, percentile75Volume: count ? 600 : null }} testID="card" />);
  expect(screen.getByText('500')).toBeTruthy();
  expect(screen.getByText('2 sets')).toBeTruthy();
  expect(screen.getByText('2 sets').parent).toBe(screen.getByText('Bench Press').parent);
  expect(screen.getByText('Building history')).toBeTruthy();
  expect(screen.queryByTestId('card-distribution')).toBeNull();
  expect(screen.queryByText(/prior|median|first comparable/i)).toBeNull();
  expect(screen.getByLabelText('Bench Press, 2 sets. Session volume 500 kg reps. Building history.')).toBeTruthy();
});

const distribution: ExerciseVolumeComparison = { ...comparison, historicalSessionCount: 6,
  medianVolume: 400, percentile25Volume: 300, percentile75Volume: 600, state: 'distribution' };

const layoutAnnotations = (plotWidth = 300, widths = [40, 60, 40]) => {
  const layout = (width: number) => ({ nativeEvent: { layout: { width, height: 53, x: 0, y: 0 } } });
  fireEvent(screen.getByTestId('card-distribution'), 'layout', layout(plotWidth));
  ['p25', 'median', 'p75'].forEach((id, index) => {
    fireEvent(screen.getByTestId(`card-${id}-annotation`, { includeHiddenElements: true }), 'layout', layout(widths[index]));
  });
};

it.each(['app', 'share'] as const)('shows quartiles after six observations in the %s card, with a centered median and current dot', variant => {
  render(<ExerciseVolumeCard comparison={distribution} variant={variant} testID="card" />);
  expect(screen.getByTestId('card-median-annotation', { includeHiddenElements: true })).toHaveStyle({ opacity: 0 });
  layoutAnnotations();
  const p25 = screen.getByTestId('card-p25-annotation', { includeHiddenElements: true });
  const median = screen.getByTestId('card-median-annotation', { includeHiddenElements: true });
  const p75 = screen.getByTestId('card-p75-annotation', { includeHiddenElements: true });
  expect(p25).toHaveTextContent(/P25.*300/);
  expect(median).toHaveTextContent(/Median.*400/);
  expect(p75).toHaveTextContent(/P75.*600/);
  expect(p25).toHaveStyle({ opacity: 1, transform: [{ translateX: 70 }] });
  expect(median).toHaveStyle({ opacity: 1, transform: [{ translateX: 120 }] });
  expect(p75).toHaveStyle({ opacity: 1, transform: [{ translateX: 250 }] });
  expect(screen.getByText('25% above median')).toBeTruthy();
  expect(screen.queryByText('Building history')).toBeNull();
  expect(screen.getByText('2 sets').parent).toBe(screen.getByText('Bench Press').parent);
  expect(screen.getByTestId('card-median', { includeHiddenElements: true })).toHaveStyle({ left: '50%' });
  expect(screen.getByTestId('card-p25', { includeHiddenElements: true })).toHaveStyle({ left: '30%' });
  expect(screen.getByTestId('card-p75', { includeHiddenElements: true })).toHaveStyle({ left: '90%' });
  expect(screen.getByTestId('card-current', { includeHiddenElements: true })).toHaveStyle({ left: '70%', backgroundColor: uiRoles.ink, borderRadius: 999 });
  expect(screen.queryByText(/prior sessions|P5$|P95$|Below P|Above P/)).toBeNull();
  expect(screen.getByLabelText(/twenty-fifth to seventy-fifth percentile 300 kg reps to 600 kg reps/)).toBeTruthy();
});

it.each([[0, '10%'], [1400, '90%']])('keeps the current dot visible outside the quartiles at volume %i', (currentVolume, left) => {
  render(<ExerciseVolumeCard comparison={{ ...distribution, currentVolume: currentVolume as number }} testID="card" />);
  layoutAnnotations();
  expect(screen.getByTestId('card-current', { includeHiddenElements: true })).toHaveStyle({ left });
  expect(screen.getByTestId('card-median', { includeHiddenElements: true })).toHaveStyle({ left: '50%' });
  expect(screen.getByTestId('card-median-annotation', { includeHiddenElements: true })).toHaveStyle({ opacity: 1 });
  expect(screen.getByTestId('card-p25-annotation', { includeHiddenElements: true })).toHaveStyle({ opacity: 0 });
  expect(screen.getByTestId('card-p75-annotation', { includeHiddenElements: true })).toHaveStyle({ opacity: 0 });
});

it('adapts crowded annotations to the available width and measured text', () => {
  render(<ExerciseVolumeCard comparison={distribution} testID="card" />);
  layoutAnnotations(240);
  expect(screen.getByTestId('card-p25-annotation', { includeHiddenElements: true })).toHaveStyle({ opacity: 0 });
  expect(screen.getByTestId('card-p75-annotation', { includeHiddenElements: true })).toHaveStyle({ opacity: 0 });
  expect(screen.getByTestId('card-median-annotation', { includeHiddenElements: true })).toHaveStyle({ opacity: 1 });
  layoutAnnotations(430);
  expect(screen.getByTestId('card-p25-annotation', { includeHiddenElements: true })).toHaveStyle({ opacity: 1 });
  expect(screen.getByTestId('card-p75-annotation', { includeHiddenElements: true })).toHaveStyle({ opacity: 1 });
  layoutAnnotations(430, [120, 60, 120]);
  expect(screen.getByTestId('card-p25-annotation', { includeHiddenElements: true })).toHaveStyle({ opacity: 0 });
  expect(screen.getByTestId('card-p75-annotation', { includeHiddenElements: true })).toHaveStyle({ opacity: 0 });
});

it.each([0, 400])('collapses an equal historical range at %i without a false interval', medianVolume => {
  render(<ExerciseVolumeCard comparison={{ ...distribution, currentVolume: medianVolume, medianVolume,
    percentile25Volume: medianVolume, percentile75Volume: medianVolume, state: 'constant-baseline' }} testID="card" />);
  expect(screen.getByText('At median')).toBeTruthy();
  for (const marker of ['p25', 'median', 'p75', 'current']) {
    expect(screen.getByTestId(`card-${marker}`, { includeHiddenElements: true })).toHaveStyle({ left: '50%' });
  }
  layoutAnnotations();
  expect(screen.getByTestId('card-median-annotation', { includeHiddenElements: true })).toHaveStyle({ opacity: 1 });
  expect(screen.getByTestId('card-p25-annotation', { includeHiddenElements: true })).toHaveStyle({ opacity: 0 });
  expect(screen.getByTestId('card-p75-annotation', { includeHiddenElements: true })).toHaveStyle({ opacity: 0 });
});

it('keeps the linear positions finite at large complete volumes', () => {
  render(<ExerciseVolumeCard comparison={{ ...distribution, currentVolume: 1e308, medianVolume: 4e307,
    percentile25Volume: 2e307, percentile75Volume: 8e307 }} testID="card" />);
  expect(screen.getByTestId('card-current', { includeHiddenElements: true })).toHaveStyle({ left: '90%' });
  expect(screen.getByTestId('card-median', { includeHiddenElements: true })).toHaveStyle({ left: '50%' });
});
