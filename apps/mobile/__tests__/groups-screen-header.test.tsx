/**
 * The Groups screen's heading: the group name as the one-line title (the
 * `title` role at any length, clipped when too long), the picker behind it, and the
 * filter row. The screen's own behaviour is groups-screens.test.tsx.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { uiFonts, uiTypography } from '@/components/ui/tokens';

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
      onSectionChange={jest.fn()}
      onSelectGroup={jest.fn()}
      section="glance"
      selectedGroupId="g1"
      {...overrides}
    />,
  );

const titleStyle = (): TextStyle => StyleSheet.flatten(screen.getByTestId('groups-title-name').props.style) as TextStyle;
const TITLE = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.lg, lineHeight: uiTypography.lineHeight.lg };

describe('the Groups heading', () => {
  it('keeps the title on one line, in the title role whatever the name\'s length', () => {
    renderHeader();
    expect(screen.getByTestId('groups-title-name').props.numberOfLines).toBe(1);
    expect(screen.getByTestId('groups-title-name').props.ellipsizeMode).toBe('tail');
    expect(titleStyle()).toMatchObject(TITLE);

    screen.unmount();
    renderHeader({ groupName: 'The Brotherhood of the Iron Ghisa' });
    expect(titleStyle()).toMatchObject(TITLE);
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

  it('shows the metric on At a glance and offers no non-weekly period switch', () => {
    renderHeader();
    expect(screen.getByTestId('groups-filter-metric')).toBeTruthy();
    expect(screen.queryByTestId('groups-filter-period')).toBeNull();

    screen.unmount();
    renderHeader({ section: 'leaderboards' });
    expect(screen.getByTestId('groups-filter-section')).toHaveTextContent('Leaderboards');
    expect(screen.queryByTestId('groups-filter-metric')).toBeNull();
    expect(screen.queryByTestId('groups-filter-period')).toBeNull();
  });
});
