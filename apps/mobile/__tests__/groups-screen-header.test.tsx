/**
 * The Groups screen's native header: the group name as the one-line title
 * (the sheet-title role, shrinking before it clips), the group switch behind
 * it, and `Manage` on the right. The screen's own behaviour is
 * groups-screens.test.tsx.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as mockReact from 'react';
import { StyleSheet, Text, type TextStyle } from 'react-native';

import { uiText } from '@/components/ui/text-roles';

import { GroupScreenHeader } from '@/components/groups/group-screen-header';

jest.mock('expo-router', () => ({
  // The header's custom title and right action render inline, so a test can read them.
  Stack: {
    Screen: ({ options }: { options: { headerTitle?: () => mockReact.ReactNode; headerRight?: () => mockReact.ReactNode } }) =>
      mockReact.createElement(mockReact.Fragment, null, options.headerTitle?.(), options.headerRight?.()),
  },
}));

const GROUPS = [
  { groupId: 'g1', name: 'Garage Gym' },
  { groupId: 'g2', name: 'Lunch Lifters' },
];

const renderHeader = (overrides: Partial<Parameters<typeof GroupScreenHeader>[0]> = {}) =>
  render(
    <GroupScreenHeader
      groupName="Garage Gym"
      groups={GROUPS}
      onOpenManage={jest.fn()}
      onSelectGroup={jest.fn()}
      selectedGroupId="g1"
      {...overrides}
    />,
  );

const titleStyle = (): TextStyle => StyleSheet.flatten(screen.getByTestId('groups-title-name').props.style) as TextStyle;

describe('the Groups header', () => {
  it('keeps the title on one line in the sheet-title role, shrinking a long name before it clips', () => {
    renderHeader({ groupName: 'The Brotherhood of the Iron Ghisa' });
    const name = screen.getByTestId('groups-title-name');
    expect(name).toHaveTextContent('The Brotherhood of the Iron Ghisa');
    expect(name.props.numberOfLines).toBe(1);
    expect(name.props.adjustsFontSizeToFit).toBe(true);
    expect(titleStyle()).toMatchObject(StyleSheet.flatten(uiText.sheetTitle) ?? {});
    // A title says where you are on its own: no line under it.
    expect(screen.queryByTestId('groups-subtitle')).toBeNull();
  });

  it('opens the switch from the title, and leaves a single group a plain heading', () => {
    const onSelectGroup = jest.fn();
    renderHeader({ onSelectGroup });

    expect(screen.getByTestId('groups-title').props.accessibilityRole).toBe('button');
    fireEvent.press(screen.getByTestId('groups-title'));
    fireEvent.press(screen.getByTestId('groups-switch-g2'));
    expect(onSelectGroup).toHaveBeenCalledWith('g2');

    screen.unmount();
    renderHeader({ groups: [GROUPS[0]!] });
    expect(screen.getByTestId('groups-title').props.accessibilityRole).toBe('header');
    expect(screen.queryByTestId('groups-switch-sheet')).toBeNull();
  });

  it('closes the switch when only one group is left, and does not reopen it when another returns', () => {
    renderHeader();
    fireEvent.press(screen.getByTestId('groups-title'));
    expect(screen.getByTestId('groups-switch-sheet').props.visible ?? true).toBeTruthy();

    screen.rerender(
      <GroupScreenHeader groupName="Garage Gym" groups={[GROUPS[0]!]} onOpenManage={jest.fn()} onSelectGroup={jest.fn()} selectedGroupId="g1" />,
    );
    expect(screen.queryByTestId('groups-switch-sheet')).toBeNull();
    screen.rerender(
      <GroupScreenHeader groupName="Garage Gym" groups={GROUPS} onOpenManage={jest.fn()} onSelectGroup={jest.fn()} selectedGroupId="g1" />,
    );
    expect(screen.queryByTestId('groups-switch-g2')).toBeNull();
  });

  it('puts the manage icon in the title bar', () => {
    const onOpenManage = jest.fn();
    renderHeader({ onOpenManage });

    expect(screen.getByTestId('groups-manage-button').props.accessibilityLabel).toBe('Manage groups');
    fireEvent.press(screen.getByTestId('groups-manage-button'));
    expect(onOpenManage).toHaveBeenCalledTimes(1);
  });

  it('draws a page action before Manage, and none when not given', () => {
    renderHeader({ headerAction: <Text testID="extra-action">⋮</Text> });
    expect(screen.getByTestId('extra-action')).toBeTruthy();
    // The title gives up width for it, so the two never overlap.
    const narrow = StyleSheet.flatten(screen.getByTestId('groups-title').props.style).maxWidth;
    expect(screen.getByTestId('groups-manage-button')).toBeTruthy();

    screen.unmount();
    renderHeader();
    expect(screen.queryByTestId('extra-action')).toBeNull();
    expect(StyleSheet.flatten(screen.getByTestId('groups-title').props.style).maxWidth).toBeGreaterThan(narrow);
  });
});
