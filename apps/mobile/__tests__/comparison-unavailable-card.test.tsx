import { render, screen } from '@testing-library/react-native';

import { ComparisonUnavailableCard } from '@/components/session-complete/comparison-unavailable-card';

it('states the cutoff once and lists the names in order, with no figures', () => {
  render(<ComparisonUnavailableCard names={['Barbell Bench Press', 'Pull-Up']} testID="pooled" />);

  expect(screen.getByText('Comparison unavailable — needs at least 7 sessions')).toBeTruthy();
  expect(screen.getByTestId('pooled')).toHaveTextContent(
    /^Comparison unavailable — needs at least 7 sessionsBarbell Bench PressPull-Up$/
  );
  // Names only: no set count, no Volume, no empty plot ([[session.volume-comparison]]).
  expect(screen.queryByText(/Vol|sets?$|P25|Median|P75/)).toBeNull();
  expect(screen.getByLabelText(
    'Comparison unavailable — needs at least 7 sessions. Barbell Bench Press, Pull-Up.'
  )).toBeTruthy();
});

it('draws nothing when every comparison has its history', () => {
  render(<ComparisonUnavailableCard names={[]} testID="pooled" />);

  expect(screen.queryByTestId('pooled')).toBeNull();
  expect(screen.queryByText(/Comparison unavailable/)).toBeNull();
});
