import { render, screen } from '@testing-library/react-native';

import { SetSummaryRow } from '@/components/session-detail/set-summary-row';
import { ExerciseSetsCard } from '@/components/session-detail/exercise-sets-card';
import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import { formatSetRow } from '@/src/session-recorder/session-view-model';

const row = formatSetRow({ id: 'set', weight: 60, reps: 8, setType: null, done: true });

it('keeps each percentage set on one line with the unit only in the exercise heading', () => {
  const normalized = { ...row, weightReps: '100.0 %BW × 8', oneRepMax: '127.7 %BW', volume: '800.0 %BW·reps' };
  render(<ExerciseSetsCard name="Bodyweight Bulgarian Split Squat" count="2 sets" percentageMetrics testID="card" rows={[
    normalized, { ...normalized, id: 'next', weightReps: '125.0 %BW × 999', oneRepMax: '1234.5 %BW', volume: '123456.7 %BW·reps' },
  ]} />);

  expect(screen.getByText('Bodyweight Bulgarian Split Squat (% BW)')).toHaveProp('ellipsizeMode', 'middle');
  expect(screen.queryByTestId('card-columns')).toBeNull();
  expect(screen.queryByText(/Weight|1RM|Vol/)).toBeNull();

  for (const [index, values] of [['100.0 × 8', '127.7', '800.0'], ['125.0 × 999', '1234.5', '123456.7']].entries()) {
    const id = `card-set-${index + 1}`;
    expect(screen.getByTestId(id)).toHaveStyle({ flexDirection: 'row', paddingVertical: uiSpace.xs });
    for (const [column, text] of [['values', values[0]], ['1rm', values[1]], ['vol', values[2]]]) {
      expect(screen.getByTestId(`${id}-${column}`)).toHaveTextContent(text, { exact: true });
      expect(screen.getByTestId(`${id}-${column}`)).toHaveProp('numberOfLines', 1);
    }
  }
  expect(screen.getByTestId('card-set-2-values')).toHaveProp('accessibilityLabel', '125.0 %BW × 999');
  expect(screen.getByLabelText('1RM 1234.5 %BW')).toBeTruthy();
  expect(screen.getByLabelText('Vol 123456.7 %BW·reps')).toBeTruthy();
});

it('keeps ordinary rows compact with inline metrics', () => {
  render(<ExerciseSetsCard name="Bench Press" count="1 set" rows={[row]} testID="ordinary-card" rowTestID={() => 'ordinary'} />);
  expect(screen.getByText('Bench Press')).toHaveProp('ellipsizeMode', 'tail');
  expect(screen.queryByText(/% BW/)).toBeNull();
  expect(screen.getByTestId('ordinary')).toHaveStyle({ flexDirection: 'row', alignItems: 'baseline' });
  expect(screen.getByTestId('ordinary-1rm')).toHaveStyle({ flexDirection: 'row' });
  expect(screen.getByTestId('ordinary-vol')).toHaveStyle({ flexDirection: 'row' });
});

it('sets 1RM and Vol in two equal fixed columns, each legend hugging its right-aligned value', () => {
  render(<SetSummaryRow row={row} testID="cols" />);
  const oneRepMaxColumn = screen.getByTestId('cols-1rm-column');
  const volumeColumn = screen.getByTestId('cols-vol-column');
  expect(oneRepMaxColumn).toHaveStyle({ width: uiGeometry.metricValueWidth + uiSpace.xl, alignItems: 'flex-end' });
  expect(volumeColumn).toHaveStyle({ width: uiGeometry.metricValueWidth + uiSpace.xl, alignItems: 'flex-end' });
  expect(screen.getByText(row.oneRepMax)).not.toHaveStyle({ width: uiGeometry.metricValueWidth });
});

it('retains reps-only context when normalized metrics are undisclosed', () => {
  render(<ExerciseSetsCard name="Pull-Up" count="1 set" rows={[{ ...row, weightReps: '8 reps' }]}
    percentageMetrics hideDerivedMetrics testID="private" />);
  expect(screen.getByText('8 reps')).toBeTruthy();
  expect(screen.getByText('Pull-Up (% BW)')).toBeTruthy();
  expect(screen.queryByTestId('private-columns')).toBeNull();
  expect(screen.queryByTestId('private-set-1-1rm')).toBeNull();
  expect(screen.queryByTestId('private-set-1-vol')).toBeNull();
});

it('preserves unavailable figures and record/planned emphasis in percentage columns', () => {
  const metrics = { ...row, oneRepMax: '127.7 %BW', volume: '800.0 %BW·reps', oneRepMaxRecord: true };
  const rendered = render(<SetSummaryRow row={metrics} percentageMetrics testID="state" />);
  expect(screen.getByTestId('state-1rm')).toHaveStyle({ color: uiRoles.record });
  rendered.rerender(<SetSummaryRow row={{ ...metrics, done: false }} percentageMetrics testID="state" />);
  expect(screen.getByTestId('state-1rm')).toHaveStyle({ color: uiRoles.inkFaint });
  expect(screen.getByTestId('state-vol')).toHaveStyle({ color: uiRoles.inkFaint });
  rendered.rerender(<SetSummaryRow row={{ ...metrics, oneRepMax: '—', volume: '—', oneRepMaxRecord: false }} percentageMetrics testID="state" />);
  expect(screen.getByLabelText('1RM —')).toHaveTextContent('—');
  expect(screen.getByLabelText('Vol —')).toHaveTextContent('—');
});
