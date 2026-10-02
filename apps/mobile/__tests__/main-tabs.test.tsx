import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { uiRoles } from '@/components/ui/tokens';

import {
  BottomTray,
  TrayVisibilityProvider,
} from '@/components/navigation/bottom-tray';
import { MainTabs } from '@/components/navigation/main-tabs';
import {
  MAIN_TAB_DEFINITIONS,
  MAIN_TAB_KEYS,
  mainTabHref,
  resolveMainTab,
  shouldShowMainNavigation,
} from '@/src/navigation/main-tabs';

describe('M26 main tab model', () => {
  it('defines four unique tabs in the approved order', () => {
    expect(MAIN_TAB_KEYS).toEqual(['today', 'train', 'progress', 'more']);
    expect(MAIN_TAB_DEFINITIONS.map((tab) => tab.label)).toEqual([
      'Today',
      'Train',
      'Progress',
      'More',
    ]);
    expect(new Set(MAIN_TAB_DEFINITIONS.map((tab) => tab.testID)).size).toBe(4);
    expect(new Set(MAIN_TAB_DEFINITIONS.map((tab) => tab.accessibilityLabel)).size).toBe(4);
    expect(MAIN_TAB_KEYS.map(mainTabHref)).toEqual([
      '/today',
      '/train',
      '/progress',
      '/more',
    ]);
  });

  it('maps canonical, nested, and legacy routes to their future owner', () => {
    expect(resolveMainTab(['(tabs)', 'today'])).toBe('today');
    expect(resolveMainTab(['(tabs)', 'train', 'planning'])).toBe('train');
    expect(resolveMainTab(['(tabs)', 'progress', 'history'])).toBe('progress');
    expect(resolveMainTab(['(tabs)', 'more', 'groups'])).toBe('more');

    expect(resolveMainTab(['(tabs)', 'stats-history'])).toBe('progress');
    expect(resolveMainTab(['(tabs)', 'exercise-catalog'])).toBe('more');
    expect(resolveMainTab(['(tabs)', 'groups'])).toBe('more');
    expect(resolveMainTab(['(tabs)', 'settings'])).toBe('more');
  });

  it('returns no selection for an unknown route instead of guessing', () => {
    expect(resolveMainTab(['(tabs)', 'unknown'])).toBeNull();
    expect(resolveMainTab([])).toBeNull();
    expect(shouldShowMainNavigation(['group', 'group-1'])).toBe(false);
  });

  it('shows the tab bar on tab-owned routes', () => {
    expect(shouldShowMainNavigation(['(tabs)', 'today'])).toBe(true);
    expect(shouldShowMainNavigation(['(tabs)', 'session-recorder'])).toBe(false);
  });
});

describe('BottomTray', () => {
  it('collapses to the accessible peek handle and expands again from it', () => {
    jest.useFakeTimers();
    const view = render(
      <TrayVisibilityProvider>
        <BottomTray>
          <Text>Tabs</Text>
        </BottomTray>
      </TrayVisibilityProvider>,
    );

    fireEvent.press(screen.getByLabelText('Collapse navigation tray'));
    act(() => {
      jest.runOnlyPendingTimers();
    });
    fireEvent.press(screen.getByLabelText('Expand navigation tray'));
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.getByLabelText('Collapse navigation tray')).toBeTruthy();
    view.unmount();
    jest.useRealTimers();
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

  it('fits four production tabs without the legacy utility-button fifth column', () => {
    render(<MainTabs activeTab="more" onSelect={jest.fn()} />);

    expect(screen.getByTestId('main-bottom-tabs')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByLabelText('Open Settings')).toBeNull();
  });
});

describe('MainTabs presentation', () => {
  it('is a tab list whose tabs report selection and navigate on press', () => {
    const onSelect = jest.fn();
    render(<MainTabs activeTab="today" onSelect={onSelect} />);

    expect(screen.getByTestId('main-bottom-tabs').props.accessibilityRole).toBe('tablist');
    expect(screen.getByLabelText('Open Today').props.accessibilityState.selected).toBe(true);
    for (const label of ['Open Train', 'Open Progress', 'Open More']) {
      expect(screen.getByLabelText(label).props.accessibilityState.selected).toBe(false);
    }

    fireEvent.press(screen.getByLabelText('Open Train'));
    fireEvent.press(screen.getByLabelText('Open Progress'));
    fireEvent.press(screen.getByLabelText('Open More'));
    expect(onSelect.mock.calls.map(([tab]) => tab)).toEqual(['train', 'progress', 'more']);
  });

  it('marks the active tab in ink by weight and an underline, never accent', () => {
    render(<MainTabs activeTab="progress" onSelect={jest.fn()} />);

    const active = StyleSheet.flatten(screen.getByText('Progress').props.style);
    const idle = StyleSheet.flatten(screen.getByText('Today').props.style);
    expect(active).toMatchObject({ color: uiRoles.ink, fontWeight: '700', fontFamily: 'Archivo' });
    expect(idle).toMatchObject({ color: uiRoles.inkMuted, fontWeight: '600' });

    const underlines = MAIN_TAB_DEFINITIONS.map(
      (tab) => StyleSheet.flatten(screen.getByTestId(`${tab.testID}-indicator`).props.style).backgroundColor,
    );
    expect(underlines).toEqual(['transparent', 'transparent', uiRoles.ink, 'transparent']);
    expect(JSON.stringify(screen.toJSON())).not.toContain(uiRoles.accent);
  });
});
