import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

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
  shouldCollapseMainNavigation,
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

    expect(resolveMainTab(['(tabs)', 'session-recorder'])).toBe('train');
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

  it('keeps recorder navigation mounted while requesting its collapsed peek state', () => {
    expect(shouldCollapseMainNavigation(['(tabs)', 'session-recorder'])).toBe(true);
    expect(shouldCollapseMainNavigation(['(tabs)', 'session-recorder', 'completed-edit'])).toBe(true);
    expect(shouldShowMainNavigation(['(tabs)', 'session-recorder'])).toBe(true);
    expect(shouldShowMainNavigation(['(tabs)', 'today'])).toBe(true);
  });
});

describe('BottomTray route entry', () => {
  it('collapses to the accessible peek handle when recorder work gains focus', () => {
    jest.useFakeTimers();
    const view = render(
      <TrayVisibilityProvider>
        <BottomTray collapseOnEntry={false}>
          <Text>Tabs</Text>
        </BottomTray>
      </TrayVisibilityProvider>,
    );
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.getByLabelText('Collapse navigation tray')).toBeTruthy();

    view.rerender(
      <TrayVisibilityProvider>
        <BottomTray collapseOnEntry>
          <Text>Tabs</Text>
        </BottomTray>
      </TrayVisibilityProvider>,
    );
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.getByLabelText('Expand navigation tray')).toBeTruthy();
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
