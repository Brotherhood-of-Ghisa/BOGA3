/**
 * The Groups screen's heading: the group name as the one-line title (sized to
 * its length, clipped past the last step), the picker behind it, and the
 * filter row. The screen's own behaviour is groups-screens.test.tsx.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { GroupScreenHeader } from '@/components/groups/group-screen-header';

const GROUPS = [
  { groupId: 'g1', name: 'Garage Gym' },
  { groupId: 'g2', name: 'Lunch Lifters' },
];

const renderHeader = (overrides: Partial<Parameters<typeof GroupScreenHeader>[0]> = {}) =>
  render(
    <GroupScreenHeader
      groupName="Garage Gym"
      groups={GROUPS}
      metric="sets"
      onMetricChange={jest.fn()}
      onOpenMyGroups={jest.fn()}
      onPeriodChange={jest.fn()}
      onSectionChange={jest.fn()}
      onSelectGroup={jest.fn()}
      period="week"
      section="glance"
      selectedGroupId="g1"
      {...overrides}
    />,
  );

const titleSize = (): number => {
  const style = StyleSheet.flatten(screen.getByTestId('groups-title-name').props.style) as TextStyle;
  return style.fontSize ?? 0;
};

describe('the Groups heading', () => {
  it('keeps the title on one line and steps its size down as the name grows', () => {
    renderHeader();
    expect(screen.getByTestId('groups-title-name').props.numberOfLines).toBe(1);
    expect(screen.getByTestId('groups-title-name').props.ellipsizeMode).toBe('tail');
    const short = titleSize();

    screen.unmount();
    renderHeader({ groupName: 'Brotherhood of Ghisa' });
    const medium = titleSize();
    expect(medium).toBeLessThan(short);

    screen.unmount();
    renderHeader({ groupName: 'The Brotherhood of the Iron Ghisa' });
    expect(titleSize()).toBeLessThan(medium);
    // A title says where you are on its own: no line under it.
    expect(screen.queryByTestId('groups-subtitle')).toBeNull();
  });

  it('opens the picker from the title, and leaves a single group unpressable', () => {
    const onSelectGroup = jest.fn();
    renderHeader({ onSelectGroup });

    fireEvent.press(screen.getByTestId('groups-title'));
    fireEvent.press(screen.getByTestId('groups-switch-g2'));
    expect(onSelectGroup).toHaveBeenCalledWith('g2');

    screen.unmount();
    renderHeader({ groups: [GROUPS[0]!] });
    fireEvent.press(screen.getByTestId('groups-title'));
    expect(screen.queryByTestId('groups-switch-sheet')).toBeNull();
  });

  it('shows the metric and period pills on At a glance only', () => {
    renderHeader();
    expect(screen.getByTestId('groups-filter-metric')).toBeTruthy();
    expect(screen.getByTestId('groups-filter-period')).toBeTruthy();

    screen.unmount();
    renderHeader({ section: 'leaderboards' });
    expect(screen.getByTestId('groups-filter-section')).toHaveTextContent('Leaderboards');
    expect(screen.queryByTestId('groups-filter-metric')).toBeNull();
    expect(screen.queryByTestId('groups-filter-period')).toBeNull();
  });
});
