import { fireEvent, renderHook, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { useUiText } from '@/components/ui/text-roles';
import { AppThemeProvider } from '@/components/ui/theme-context';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';
import { renderWithTheme, rolesFor } from './helpers/theme';

const roles = rolesFor(DEFAULT_APPEARANCE);
// The live text roles. Read before the render under test: `renderHook` would
// otherwise take over `screen`.
const liveText = () => renderHook(() => useUiText(), { wrapper: AppThemeProvider }).result.current;

const mockPush = jest.fn();
const mockTabsProps: { screenOptions?: object; screens: Record<string, object> } = { screens: {} };

jest.mock('expo-router', () => {
  const { createElement, Fragment } = jest.requireActual<typeof import('react')>('react');
  return {
    Tabs: Object.assign(
      ({ children, screenOptions }: { children: import('react').ReactNode; screenOptions: object }) => {
        mockTabsProps.screenOptions = screenOptions;
        return createElement(Fragment, null, children);
      },
      {
        Screen: ({ name, options }: { name: string; options: object }) => {
          mockTabsProps.screens[name] = options;
          return null;
        },
      },
    ),
    useRouter: () => ({ push: mockPush }),
  };
});

import TabsLayout, { TabsBar } from '../app/(tabs)/_layout';
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
    renderWithTheme(<MainTabBar activeTab="train" onSelect={onSelect} />);

    expect(StyleSheet.flatten(screen.getByTestId('main-tab-bar').props.style).backgroundColor).toBe(roles.paper);
    expect(screen.getByLabelText('Open Train').props.accessibilityState.selected).toBe(true);
    expect(screen.queryByTestId('bottom-tray-handle')).toBeNull();
    fireEvent.press(screen.getByLabelText('Open More'));
    expect(onSelect).toHaveBeenCalledWith('more');
  });
});

describe('TabsLayout', () => {
  it('paints the status-bar inset on the paper ground, matching the tab pages', () => {
    renderWithTheme(<TabsLayout />);
    expect(mockTabsProps.screenOptions).toMatchObject({
      sceneStyle: { backgroundColor: roles.paper, paddingTop: expect.any(Number) },
    });
  });

  it("leaves Train to clear the status bar itself, so its workout's top bar runs under it", () => {
    renderWithTheme(<TabsLayout />);
    expect(mockTabsProps.screens.train).toEqual({
      title: 'Train',
      sceneStyle: { backgroundColor: roles.paper },
    });
  });
});

describe('TabsBar', () => {
  it("selects the tab navigator's focused route, so a screen pushed over the tabs never hides it", () => {
    renderWithTheme(<TabsBar routeName="train" />);
    expect(screen.getByLabelText('Open Train').props.accessibilityState.selected).toBe(true);
    screen.unmount();

    renderWithTheme(<TabsBar routeName="stats-history" />);
    expect(screen.getByLabelText('Open Progress').props.accessibilityState.selected).toBe(true);
    screen.unmount();

    renderWithTheme(<TabsBar routeName="groups" />);
    expect(screen.getByLabelText('Open Groups').props.accessibilityState.selected).toBe(true);
  });

  it('switches tabs in place: Train is a tab like any other, with the workout on it', () => {
    renderWithTheme(<TabsBar routeName="today" />);
    fireEvent.press(screen.getByLabelText('Open Train'));
    fireEvent.press(screen.getByLabelText('Open Progress'));
    expect(mockPush.mock.calls).toEqual([['/train'], ['/progress']]);
  });

  it('draws nothing for a route no tab owns', () => {
    renderWithTheme(<TabsBar routeName="unknown" />);
    expect(screen.queryByTestId('main-tab-bar')).toBeNull();
  });
});

describe('MainTabs', () => {
  it('renders accessible selected state and reports every tab press', () => {
    const onSelect = jest.fn();
    renderWithTheme(<MainTabs activeTab="today" onSelect={onSelect} />);

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
    renderWithTheme(<MainTabs activeTab="more" onSelect={jest.fn()} />);

    expect(screen.getByTestId('main-bottom-tabs')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.queryByText('More')).toBeNull();
    expect(screen.getByLabelText('Open More').props.accessibilityState.selected).toBe(true);
    expect(screen.queryByLabelText('Open Settings')).toBeNull();
  });

  it('keeps the ⋮ inside the bordered tab card, not beside it', () => {
    renderWithTheme(<MainTabs activeTab="today" onSelect={jest.fn()} />);

    const card = screen.getByTestId('main-bottom-tabs');
    expect(StyleSheet.flatten(card.props.style)).toMatchObject({ borderWidth: expect.any(Number) });
    for (const tab of MAIN_TAB_DEFINITIONS) {
      expect(within(card).getByTestId(tab.testID)).toBeTruthy();
    }
    // More is the last child: the card's right edge.
    const children = card.children.map((child) => (typeof child === 'string' ? child : child.props.testID));
    expect(children.at(-1)).toBe('top-level-tab-more');
  });
});

describe('MainTabs presentation', () => {
  it('is a tab list whose tabs report selection and navigate on press', () => {
    const onSelect = jest.fn();
    renderWithTheme(<MainTabs activeTab="today" onSelect={onSelect} />);

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
    const uiText = liveText();
    renderWithTheme(<MainTabs activeTab="progress" onSelect={jest.fn()} />);

    const active = StyleSheet.flatten(screen.getByText('Progress').props.style);
    const idle = StyleSheet.flatten(screen.getByText('Today').props.style);
    expect(active).toEqual({ ...StyleSheet.flatten(uiText.label), color: roles.ink });
    expect(idle).toEqual(StyleSheet.flatten(uiText.label));
    expect(idle).toMatchObject({ color: roles.inkMuted, textTransform: 'uppercase' });

    const underlines = MAIN_TAB_DEFINITIONS.map(
      (tab) => StyleSheet.flatten(screen.getByTestId(`${tab.testID}-indicator`).props.style).backgroundColor,
    );
    expect(underlines).toEqual(['transparent', 'transparent', roles.ink, 'transparent', 'transparent']);
    expect(JSON.stringify(screen.toJSON())).not.toContain(roles.accent);
  });
});
