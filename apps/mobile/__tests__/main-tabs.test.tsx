import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { uiText } from '@/components/ui/text-roles';
import { uiRoles } from '@/components/ui/tokens';

jest.mock('expo-router', () => ({
  Tabs: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => ({ push: jest.fn() }),
}));

import { TabsBar } from '../app/(tabs)/_layout';
import { MainTabBar } from '@/components/navigation/main-tab-bar';
import { MainTabs } from '@/components/navigation/main-tabs';
import {
  MAIN_TAB_DEFINITIONS,
  MAIN_TAB_KEYS,
  mainTabHref,
  resolveMainTab,
} from '@/src/navigation/main-tabs';

describe('main tab model', () => {
  it('defines four labelled tabs and More as the overflow, in the approved order', () => {
    expect(MAIN_TAB_KEYS).toEqual(['today', 'train', 'progress', 'groups', 'more']);
    expect(MAIN_TAB_DEFINITIONS.map((tab) => tab.label)).toEqual([
      'Today',
      'Train',
      'Progress',
      'Groups',
      'More',
    ]);
    expect(MAIN_TAB_DEFINITIONS.map((tab) => tab.presentation)).toEqual([
      'label',
      'label',
      'label',
      'label',
      'overflow',
    ]);
    expect(new Set(MAIN_TAB_DEFINITIONS.map((tab) => tab.testID)).size).toBe(5);
    expect(new Set(MAIN_TAB_DEFINITIONS.map((tab) => tab.accessibilityLabel)).size).toBe(5);
    expect(MAIN_TAB_KEYS.map(mainTabHref)).toEqual([
      '/today',
      '/train',
      '/progress',
      '/groups',
      '/more',
    ]);
  });

  it('maps canonical, nested, and legacy routes to their future owner', () => {
    expect(resolveMainTab(['(tabs)', 'today'])).toBe('today');
    expect(resolveMainTab(['(tabs)', 'train', 'planning'])).toBe('train');
    expect(resolveMainTab(['(tabs)', 'progress', 'history'])).toBe('progress');
    expect(resolveMainTab(['(tabs)', 'groups'])).toBe('groups');
    expect(resolveMainTab(['(tabs)', 'more', 'settings'])).toBe('more');

    expect(resolveMainTab(['(tabs)', 'stats-history'])).toBe('progress');
    expect(resolveMainTab(['(tabs)', 'exercise-catalog'])).toBe('more');
    expect(resolveMainTab(['(tabs)', 'settings'])).toBe('more');
  });

  it('returns no selection for an unknown route instead of guessing', () => {
    expect(resolveMainTab(['(tabs)', 'unknown'])).toBeNull();
    expect(resolveMainTab([])).toBeNull();
  });
});

describe('MainTabBar', () => {
  it('is the tabs on the paper ground, with no collapsible tray handle', () => {
    const onSelect = jest.fn();
    render(<MainTabBar activeTab="train" onSelect={onSelect} />);

    expect(StyleSheet.flatten(screen.getByTestId('main-tab-bar').props.style).backgroundColor).toBe(uiRoles.paper);
    expect(screen.getByLabelText('Open Train').props.accessibilityState.selected).toBe(true);
    expect(screen.queryByTestId('bottom-tray-handle')).toBeNull();
    fireEvent.press(screen.getByLabelText('Open More'));
    expect(onSelect).toHaveBeenCalledWith('more');
  });
});

describe('TabsBar', () => {
  it("selects the tab navigator's focused route, so a screen pushed over the tabs never hides it", () => {
    render(<TabsBar routeName="train" />);
    expect(screen.getByLabelText('Open Train').props.accessibilityState.selected).toBe(true);
    screen.unmount();

    render(<TabsBar routeName="stats-history" />);
    expect(screen.getByLabelText('Open Progress').props.accessibilityState.selected).toBe(true);
    screen.unmount();

    render(<TabsBar routeName="groups" />);
    expect(screen.getByLabelText('Open Groups').props.accessibilityState.selected).toBe(true);
  });

  it('draws nothing for a route no tab owns', () => {
    render(<TabsBar routeName="unknown" />);
    expect(screen.queryByTestId('main-tab-bar')).toBeNull();
  });
});

describe('MainTabs', () => {
  it('renders accessible selected state and reports every tab press', () => {
    const onSelect = jest.fn();
    render(<MainTabs activeTab="today" onSelect={onSelect} />);

    for (const tab of MAIN_TAB_DEFINITIONS) {
      const element = screen.getByTestId(tab.testID);
      expect(element.props.accessibilityState).toMatchObject({
        selected: tab.key === 'today',
      });
      fireEvent.press(element);
    }

    expect(onSelect.mock.calls.map(([tab]) => tab)).toEqual(MAIN_TAB_KEYS);
  });

  it('draws four labelled tabs and More as a bare ⋮, with no Settings tab', () => {
    render(<MainTabs activeTab="more" onSelect={jest.fn()} />);

    expect(screen.getByTestId('main-bottom-tabs')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.queryByText('More')).toBeNull();
    expect(screen.getByLabelText('Open More').props.accessibilityState.selected).toBe(true);
    expect(screen.queryByLabelText('Open Settings')).toBeNull();
  });
});

describe('MainTabs presentation', () => {
  it('is a tab list whose tabs report selection and navigate on press', () => {
    const onSelect = jest.fn();
    render(<MainTabs activeTab="today" onSelect={onSelect} />);

    expect(screen.getByTestId('main-bottom-tabs').props.accessibilityRole).toBe('tablist');
    expect(screen.getByLabelText('Open Today').props.accessibilityState.selected).toBe(true);
    for (const label of ['Open Train', 'Open Progress', 'Open Groups', 'Open More']) {
      expect(screen.getByLabelText(label).props.accessibilityState.selected).toBe(false);
    }

    fireEvent.press(screen.getByLabelText('Open Train'));
    fireEvent.press(screen.getByLabelText('Open Progress'));
    fireEvent.press(screen.getByLabelText('Open Groups'));
    fireEvent.press(screen.getByLabelText('Open More'));
    expect(onSelect.mock.calls.map(([tab]) => tab)).toEqual(['train', 'progress', 'groups', 'more']);
  });

  it('draws each tab as a micro-label, the active one in ink over an underline, never accent', () => {
    render(<MainTabs activeTab="progress" onSelect={jest.fn()} />);

    const active = StyleSheet.flatten(screen.getByText('Progress').props.style);
    const idle = StyleSheet.flatten(screen.getByText('Today').props.style);
    expect(active).toEqual({ ...StyleSheet.flatten(uiText.label), color: uiRoles.ink });
    expect(idle).toEqual(StyleSheet.flatten(uiText.label));
    expect(idle).toMatchObject({ color: uiRoles.inkMuted, textTransform: 'uppercase' });

    const underlines = MAIN_TAB_DEFINITIONS.map(
      (tab) => StyleSheet.flatten(screen.getByTestId(`${tab.testID}-indicator`).props.style).backgroundColor,
    );
    expect(underlines).toEqual(['transparent', 'transparent', uiRoles.ink, 'transparent', 'transparent']);
    expect(JSON.stringify(screen.toJSON())).not.toContain(uiRoles.accent);
  });
});
