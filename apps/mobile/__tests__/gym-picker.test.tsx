/**
 * The views' gym filter (`components/gyms/gym-picker.tsx`) on hand-built
 * options: the three-state scope it reads and writes, how it names a choice,
 * and when it is not drawn. The views that host it prove it over real data
 * (`stats-screen-local-data`, `exercise-catalog-screen`,
 * `progress-history-local-data`).
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { GymPicker } from '@/components/gyms/gym-picker';
import type { GymScopeOption } from '@/src/utils/gym-scope-route';

const OPTIONS: GymScopeOption[] = [
  { gymId: 'club', name: 'Club', sessionCount: 12 },
  { gymId: 'home', name: 'Home', sessionCount: 5 },
  { gymId: null, name: null, sessionCount: 2 },
];

const renderPicker = (value: string | null | undefined, options: GymScopeOption[] = OPTIONS) => {
  const onChange = jest.fn();
  render(<GymPicker allSessionCount={19} onChange={onChange} options={options} testID="gym" value={value} />);
  return onChange;
};

describe('GymPicker', () => {
  it('opens on every gym, and offers All gyms, each gym and No gym with their sessions', () => {
    renderPicker(undefined);
    expect(screen.getByTestId('gym')).toHaveTextContent('All gyms');
    expect(screen.getByLabelText('Gym: All gyms')).toBeTruthy();

    fireEvent.press(screen.getByTestId('gym'));
    expect(screen.getByRole('radio', { name: 'All gyms, 19 sessions' })).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByRole('radio', { name: 'Club, 12 sessions' })).toHaveProp('accessibilityState', { checked: false });
    expect(screen.getByRole('radio', { name: 'No gym, 2 sessions' })).toBeTruthy();
  });

  it('writes the three-state scope: an id, null for No gym, unset for All gyms', () => {
    const onChange = renderPicker('club');
    expect(screen.getByTestId('gym')).toHaveTextContent('Club');

    fireEvent.press(screen.getByTestId('gym'));
    fireEvent.press(screen.getByTestId('gym-option-no-gym'));
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.press(screen.getByTestId('gym'));
    fireEvent.press(screen.getByTestId('gym-option-all'));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    fireEvent.press(screen.getByTestId('gym'));
    fireEvent.press(screen.getByTestId('gym-option-home'));
    expect(onChange).toHaveBeenLastCalledWith('home');
    // The choice already in force is no change.
    fireEvent.press(screen.getByTestId('gym'));
    fireEvent.press(screen.getByTestId('gym-option-club'));
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('draws the same button at the compact size, for a row it shares with a segmented control', () => {
    const onChange = jest.fn();
    render(<GymPicker onChange={onChange} options={OPTIONS} size="compact" testID="gym" value="home" />);
    expect(screen.getByLabelText('Gym: Home')).toHaveProp('hitSlop', 8);
    fireEvent.press(screen.getByTestId('gym'));
    fireEvent.press(screen.getByTestId('gym-option-all'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('keeps a chosen gym the options no longer list among its rows', () => {
    renderPicker('annex');
    expect(screen.getByTestId('gym')).toHaveTextContent('Selected gym');
    fireEvent.press(screen.getByTestId('gym'));
    expect(screen.getByTestId('gym-option-annex')).toHaveProp('accessibilityState', { checked: true });
  });

  it('is not drawn with no gym to tell apart, unless a choice is in force to clear', () => {
    renderPicker(undefined, []);
    expect(screen.queryByTestId('gym')).toBeNull();
    renderPicker(undefined, [{ gymId: null, name: null }]);
    expect(screen.queryByTestId('gym')).toBeNull();
    renderPicker(null, [{ gymId: null, name: null }]);
    expect(screen.getByTestId('gym')).toHaveTextContent('No gym');
  });
});
