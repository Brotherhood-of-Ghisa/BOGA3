import { render, screen } from '@testing-library/react-native';

import { BuildingHistoryCard } from '@/components/session-complete/building-history-card';

it('states the cutoff once and lists the names in order, with no figures', () => {
  render(<BuildingHistoryCard names={['Barbell Bench Press', 'Pull-Up']} testID="pooled" />);

  expect(screen.getByText('Building history')).toBeTruthy();
  expect(screen.getByText('A volume comparison needs 6 prior comparable sessions.')).toBeTruthy();
  expect(screen.getByTestId('pooled')).toHaveTextContent(
    /^Building historyA volume comparison needs 6 prior comparable sessions\.Barbell Bench PressPull-Up$/
  );
  // Names only: no set count, no Volume, no empty plot ([[session.volume-comparison]]).
  expect(screen.queryByText(/Vol|sets?$|P25|Median|P75/)).toBeNull();
  expect(screen.getByLabelText(
    'Building history. A volume comparison needs 6 prior comparable sessions. Barbell Bench Press, Pull-Up.'
  )).toBeTruthy();
});

it('draws nothing when every comparison has its history', () => {
  render(<BuildingHistoryCard names={[]} testID="pooled" />);

  expect(screen.queryByTestId('pooled')).toBeNull();
  expect(screen.queryByText('Building history')).toBeNull();
});
