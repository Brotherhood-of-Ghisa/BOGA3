/* eslint-disable import/first */

/**
 * More's destinations through the real Expo Router: the tab layout under a
 * root stack, as the app is built. Settings, Exercises and Groups are
 * root-stack pages pushed over the tabs (`TabOwnedPage`): each keeps the tab
 * bar with More selected, back returns to More, and a tab press returns to
 * the tabs underneath instead of stacking another copy. The More screen's own
 * rows and their hrefs are `more-screen.test.tsx`; the Settings screen itself
 * is `settings-profile-navigation.test.tsx` and the settings suites.
 */

jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
jest.mock('@/src/utils/isDevMode', () => ({ isDevMode: () => false }));
jest.mock('@/src/utils/agent-connect', () => ({
  getAgentConnectUrl: () => 'https://example.test/connect',
}));
jest.mock('@/src/navigation/active-session-entry', () => ({
  mainTabDestination: (tab: string) => Promise.resolve(`/${tab}`),
}));

import { act, fireEvent, screen } from '@testing-library/react-native';
import { Stack, router as appRouter } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import TabsLayout from '../app/(tabs)/_layout';
import MoreScreen from '../app/(tabs)/more';
import { TabOwnedPage } from '@/components/navigation/tab-owned-page';

const stub = (testID: string) =>
  function Stub() {
    return <Text testID={testID}>{testID}</Text>;
  };

const tabOwnedStub = (testID: string) =>
  function TabOwnedStub() {
    return (
      <TabOwnedPage>
        <Text testID={testID}>{testID}</Text>
      </TabOwnedPage>
    );
  };

const renderApp = () =>
  renderRouter(
    {
      _layout: () => <Stack />,
      '(tabs)/_layout': TabsLayout,
      '(tabs)/today': stub('today-stub'),
      '(tabs)/train': stub('train-stub'),
      '(tabs)/progress': stub('progress-stub'),
      '(tabs)/more': MoreScreen,
      '(tabs)/stats-history': stub('stats-stub'),
      'exercise-catalog': tabOwnedStub('catalog-stub'),
      groups: tabOwnedStub('groups-stub'),
      settings: tabOwnedStub('settings-stub'),
      gyms: stub('gyms-stub'),
    },
    { initialUrl: '/more' }
  );

const expectMoreSelected = () =>
  expect(screen.getByTestId('top-level-tab-more')).toHaveProp(
    'accessibilityState',
    expect.objectContaining({ selected: true })
  );

it.each([
  ['more-settings-row', 'settings-stub', '/settings'],
  ['more-exercises-row', 'catalog-stub', '/exercise-catalog'],
  ['more-groups-row', 'groups-stub', '/groups'],
])('%s pushes %s over the tabs with More still selected, and back returns to More', async (row, stubID, path) => {
  const router = await renderApp();
  expect(await screen.findByTestId('more-screen')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId(row));
  });

  expect(await screen.findByTestId(stubID)).toBeTruthy();
  expect(router.getPathname()).toBe(path);
  // No `source=more` marker: the page looks the same however it was reached.
  expect(router.getSearchParams()).toEqual({});
  expectMoreSelected();

  await act(async () => {
    appRouter.back();
  });
  expect(router.getPathname()).toBe('/more');
  expect(screen.getByTestId('more-screen')).toBeTruthy();
});

it('opens Gyms without a source marker', async () => {
  const router = await renderApp();
  await screen.findByTestId('more-screen');
  await act(async () => {
    fireEvent.press(screen.getByTestId('more-gyms-row'));
  });
  expect(await screen.findByTestId('gyms-stub')).toBeTruthy();
  expect(router.getPathname()).toBe('/gyms');
  expect(router.getSearchParams()).toEqual({});
});

it('a tab press on a More page returns to the tabs underneath', async () => {
  const router = await renderApp();
  await screen.findByTestId('more-screen');
  await act(async () => {
    fireEvent.press(screen.getByTestId('more-settings-row'));
  });
  await screen.findByTestId('settings-stub');

  await act(async () => {
    fireEvent.press(screen.getAllByTestId('top-level-tab-today').at(-1)!);
  });

  expect(await screen.findByTestId('today-stub')).toBeTruthy();
  expect(router.getPathname()).toBe('/today');
  // The settings page was dismissed, not left under a second tab shell.
  expect(appRouter.canGoBack()).toBe(false);
});
