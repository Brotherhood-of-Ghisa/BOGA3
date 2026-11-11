import { screen } from '@testing-library/react-native';

import { SetSummaryRow } from '@/components/session-detail/set-summary-row';
import { ExerciseSetsCard } from '@/components/session-detail/exercise-sets-card';
import { uiGeometry, uiSpace } from '@/components/ui/tokens';
import { formatSetRow } from '@/src/session-recorder/session-view-model';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';
import { renderWithTheme, rolesFor } from './helpers/theme';

const roles = rolesFor(DEFAULT_APPEARANCE);

const row = formatSetRow({ id: 'set', weight: 60, reps: 8, setType: null, done: true });

it('keeps exercise names unchanged and places small explicit units beside every percentage figure', () => {
  const normalized = { ...row, weightReps: '0.0 %BW × 8', oneRepMax: '27.7 %BW', volume: '800.0 %BW·reps' };
  renderWithTheme(<ExerciseSetsCard name="Bodyweight Bulgarian Split Squat" count="2 sets" percentageMetrics testID="card" rows={[
    normalized, { ...normalized, id: 'next', weightReps: '25.0 %BW × 999', oneRepMax: '1234.5 %BW', volume: '123456.7 %BW·reps' },
  ]} />);
  expect(screen.getByText('Bodyweight Bulgarian Split Squat')).toHaveProp('ellipsizeMode', 'tail');
  expect(screen.queryByText(/\(% BW\)/)).toBeNull();
  expect(screen.getByTestId('card-set-1-values')).toHaveTextContent('0.0 %BW × 8');
  expect(screen.getByTestId('card-set-2-values')).toHaveTextContent('25.0 %BW × 999');
  expect(screen.getByLabelText('1RM 1234.5 %BW')).toHaveTextContent(/1234.5\s%BW/);
  expect(screen.getByLabelText('Vol 123456.7 %BW·reps')).toHaveTextContent(/123456.7\s%BW·reps/);
  expect(screen.getAllByText('%BW').length).toBe(4);
  expect(screen.getAllByText('%BW·reps').length).toBe(2);
});

it('keeps ordinary rows compact with inline metrics', () => {
  renderWithTheme(<ExerciseSetsCard name="Bench Press" count="1 set" rows={[row]} testID="ordinary-card" rowTestID={() => 'ordinary'} />);
  expect(screen.getByText('Bench Press')).toHaveProp('ellipsizeMode', 'tail');
  expect(screen.queryByText(/% BW/)).toBeNull();
  expect(screen.getByTestId('ordinary')).toHaveStyle({ flexDirection: 'row', alignItems: 'baseline' });
  expect(screen.getByTestId('ordinary-1rm')).toHaveStyle({ flexDirection: 'row' });
  expect(screen.getByTestId('ordinary-vol')).toHaveStyle({ flexDirection: 'row' });
});

it('sets 1RM and Vol in two equal fixed columns, each legend hugging its right-aligned value', () => {
  renderWithTheme(<SetSummaryRow row={row} testID="cols" />);
  const oneRepMaxColumn = screen.getByTestId('cols-1rm-column');
  const volumeColumn = screen.getByTestId('cols-vol-column');
  expect(oneRepMaxColumn).toHaveStyle({ width: uiGeometry.metricValueWidth + uiSpace.xl + uiSpace.sm, alignItems: 'flex-end' });
  expect(volumeColumn).toHaveStyle({ width: uiGeometry.metricValueWidth + uiSpace.xl, alignItems: 'flex-end' });
  expect(screen.getByText(row.oneRepMax)).not.toHaveStyle({ width: uiGeometry.metricValueWidth });
});

it('retains reps-only context when normalized metrics are undisclosed', () => {
  renderWithTheme(<ExerciseSetsCard name="Pull-Up" count="1 set" rows={[{ ...row, weightReps: '8 reps' }]}
    percentageMetrics hideDerivedMetrics testID="private" />);
  expect(screen.getByText('8 reps')).toBeTruthy();
  expect(screen.getByText('Pull-Up')).toBeTruthy();
  expect(screen.queryByTestId('private-columns')).toBeNull();
  expect(screen.queryByTestId('private-set-1-1rm')).toBeNull();
  expect(screen.queryByTestId('private-set-1-vol')).toBeNull();
});

it('preserves unavailable figures and record/planned emphasis in percentage columns', () => {
  const metrics = { ...row, oneRepMax: '27.7 %BW', volume: '800.0 %BW·reps', oneRepMaxRecord: true };
  const rendered = renderWithTheme(<SetSummaryRow row={metrics} percentageMetrics testID="state" />);
  expect(screen.getByText('27.7')).toHaveStyle({ color: roles.record });
  rendered.rerender(<SetSummaryRow row={{ ...metrics, done: false }} percentageMetrics testID="state" />);
  expect(screen.getByText('27.7')).toHaveStyle({ color: roles.inkFaint });
  expect(screen.getByText('800.0')).toHaveStyle({ color: roles.inkFaint });
  rendered.rerender(<SetSummaryRow row={{ ...metrics, oneRepMax: '—', volume: '—', oneRepMaxRecord: false }} percentageMetrics testID="state" />);
  expect(screen.getByLabelText('1RM —')).toBeTruthy();
  expect(screen.getByLabelText('Vol —')).toBeTruthy();
});
