/**
 * Progress's Filters button and sheet (`components/stats/progress-filters.tsx`)
 * on hand-built choices: which choices it offers, how the button reports a
 * changed one, and that the sheet stays open across choices. The screen proves
 * the choices' effects over real data (`stats-screen-local-data`).
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import * as ReactNative from 'react-native';
import { Modal } from 'react-native';

import { changedFilters, ProgressFilters, type ProgressFiltersProps } from '@/components/stats/progress-filters';
import type { GymScopeOption } from '@/src/utils/gym-scope-route';

const OPTIONS: GymScopeOption[] = [{ gymId: 'club', name: 'Club' }, { gymId: null, name: null }];

function Harness({ offered, onGym }: { offered: ('grouping' | 'secondary' | 'gym')[]; onGym?: jest.Mock }) {
  const [grouped, setGrouped] = useState(true);
  const [secondary, setSecondary] = useState(true);
  const [gymId, setGymId] = useState<string | null | undefined>(undefined);
  const props: ProgressFiltersProps = {
    testID: 'filters',
    grouping: offered.includes('grouping') ? { value: grouped, onChange: setGrouped } : undefined,
    secondary: offered.includes('secondary') ? { value: secondary, onChange: setSecondary } : undefined,
    gym: offered.includes('gym') ? { value: gymId, options: OPTIONS, onChange: next => { onGym?.(next); setGymId(next); } } : undefined,
  };
  return <ProgressFilters {...props} />;
}

describe('ProgressFilters', () => {
  it('draws no button without a choice to offer, counting a gym only when there is one to tell apart', () => {
    render(<ProgressFilters testID="filters" />);
    expect(screen.queryByTestId('filters')).toBeNull();
    render(<ProgressFilters testID="filters" gym={{ value: undefined, options: [{ gymId: null, name: null }], onChange: jest.fn() }} />);
    expect(screen.queryByTestId('filters')).toBeNull();
  });

  it('offers only the choices given, keeps the sheet open across them, and counts each one changed', () => {
    const onGym = jest.fn();
    render(<Harness offered={['grouping', 'secondary', 'gym']} onGym={onGym} />);
    const button = () => screen.getByTestId('filters');
    expect(button()).toHaveProp('accessibilityLabel', 'Filters');
    fireEvent.press(button());
    expect(screen.getByRole('switch', { name: 'Group by muscle family' })).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByRole('switch', { name: 'Count secondary sets' })).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByRole('header', { name: 'Gym' })).toBeTruthy();
    expect(screen.getByTestId('stats-gym-option-all')).toHaveProp('accessibilityState', { checked: true });

    fireEvent.press(screen.getByTestId('stats-secondary-toggle'));
    fireEvent.press(screen.getByTestId('stats-gym-option-no-gym'));
    expect(onGym).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId('stats-secondary-toggle')).toHaveProp('accessibilityState', { checked: false });
    expect(screen.getByTestId('stats-gym-option-no-gym')).toHaveProp('accessibilityState', { checked: true });
    fireEvent(screen.getByTestId('filters-sheet'), 'accessibilityEscape');
    // The label names each changed choice, so the gym in force is never only a count.
    expect(button()).toHaveProp('accessibilityLabel', 'Filters: No gym, secondary sets not counted');

    fireEvent.press(button());
    fireEvent.press(screen.getByTestId('stats-group-toggle'));
    fireEvent(screen.getByTestId('filters-sheet'), 'accessibilityEscape');
    expect(button()).toHaveProp('accessibilityLabel', 'Filters: No gym, not grouped, secondary sets not counted');
  });

  it('returns screen-reader focus to the button once the sheet has gone', () => {
    const focused = jest.spyOn(ReactNative.AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
    render(<Harness offered={['secondary']} />);
    // The test renderer gives host views no instance; stand one in for the
    // button's wrapper so this exercises the sheet's return-focus wiring.
    const origin = screen.UNSAFE_getAllByType(ReactNative.View).find(view => view.props.collapsable === false && view.props.ref)!;
    origin.props.ref.current = { canonical: { nativeTag: 77 } };
    fireEvent.press(screen.getByTestId('filters'));
    fireEvent(screen.getByTestId('filters-sheet'), 'accessibilityEscape');
    expect(focused).not.toHaveBeenCalled();
    act(() => screen.UNSAFE_getAllByType(Modal).find(modal => modal.props.testID === 'filters-sheet-modal')!.props.onDismiss());
    expect(focused).toHaveBeenLastCalledWith(77);
    focused.mockRestore();
  });

  it('holds the secondary choice alone where no table or gym applies', () => {
    render(<Harness offered={['secondary']} />);
    fireEvent.press(screen.getByTestId('filters'));
    expect(screen.getByTestId('stats-secondary-toggle')).toBeTruthy();
    expect(screen.queryByTestId('stats-group-toggle')).toBeNull();
    expect(screen.queryAllByTestId(/^stats-gym-option-/)).toHaveLength(0);
  });

  it('names only choices off their opening value', () => {
    const toggle = (value: boolean) => ({ value, onChange: jest.fn() });
    expect(changedFilters({})).toEqual([]);
    expect(changedFilters({ grouping: toggle(true), secondary: toggle(true), gym: { value: undefined, options: OPTIONS, onChange: jest.fn() } })).toEqual([]);
    expect(changedFilters({ grouping: toggle(false), secondary: toggle(false), gym: { value: 'club', options: OPTIONS, onChange: jest.fn() } }))
      .toEqual(['Club', 'not grouped', 'secondary sets not counted']);
  });
});
