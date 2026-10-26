import { render, screen, within } from '@testing-library/react-native';

import { SetSummaryRow } from '@/components/session-detail/set-summary-row';
import { uiSpace } from '@/components/ui/tokens';
import { formatSetRow } from '@/src/session-recorder/session-view-model';

const row = formatSetRow({ id: 'set', weight: 60, reps: 8, setType: null, done: true });

it('separates normalized details from wrapping metrics and spaces adjacent sets', () => {
  const normalized = { ...row, weightReps: '0.0 %BW × 8', oneRepMax: '127.7 %BW', volume: '800.0 %BW·reps' };
  render(<>
    <SetSummaryRow row={normalized} stackedMetrics testID="first" />
    <SetSummaryRow row={{ ...normalized, volume: '12345.6 %BW·reps' }} stackedMetrics testID="next" />
  </>);

  for (const id of ['first', 'next']) {
    expect(screen.getByTestId(id)).toHaveStyle({ flexDirection: 'column', paddingVertical: uiSpace.sm, gap: uiSpace.sm });
    const details = within(screen.getByTestId(`${id}-details`));
    expect(details.getByText('0.0 %BW × 8')).toBeTruthy();
    expect(details.queryByText('127.7 %BW')).toBeNull();
    const metrics = screen.getByTestId(`${id}-metrics`);
    expect(metrics).toHaveStyle({ flexDirection: 'row', flexWrap: 'wrap', gap: uiSpace.lg });
    expect(within(metrics).getByLabelText('1RM 127.7 %BW')).toBeTruthy();
    expect(within(metrics).getByLabelText(id === 'first' ? 'Vol 800.0 %BW·reps' : 'Vol 12345.6 %BW·reps')).toBeTruthy();
  }
});

it('keeps ordinary rows compact with inline metrics', () => {
  render(<SetSummaryRow row={row} testID="ordinary" />);
  expect(screen.getByTestId('ordinary')).toHaveStyle({ flexDirection: 'row', alignItems: 'baseline' });
  expect(screen.getByTestId('ordinary-1rm')).toHaveStyle({ flexDirection: 'row' });
  expect(screen.getByTestId('ordinary-vol')).toHaveStyle({ flexDirection: 'row' });
  expect(screen.queryByTestId('ordinary-details')).toBeNull();
  expect(screen.queryByTestId('ordinary-metrics')).toBeNull();
});

it('retains reps-only context when normalized metrics are undisclosed', () => {
  render(<SetSummaryRow row={{ ...row, weightReps: '8 reps' }} stackedMetrics hideDerivedMetrics testID="private" />);
  expect(within(screen.getByTestId('private-details')).getByText('8 reps')).toBeTruthy();
  expect(screen.queryByTestId('private-metrics')).toBeNull();
  expect(screen.queryByTestId('private-1rm')).toBeNull();
  expect(screen.queryByTestId('private-vol')).toBeNull();
});
