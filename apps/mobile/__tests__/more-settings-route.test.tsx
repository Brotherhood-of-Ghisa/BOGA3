/* eslint-disable import/first */

/**
 * More → Settings through the real Expo Router and the real tab layout: the
 * More row's href resolves to the Settings route inside the tab shell, with
 * More still the active tab. The More screen's own rows and their hrefs are
 * `more-screen.test.tsx`; the Settings screen itself is
 * `settings-profile-navigation.test.tsx` and the settings suites.
 */

jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
jest.mock('@/src/utils/isDevMode', () => ({ isDevMode: () => false }));
jest.mock('@/src/utils/agent-connect', () => ({
  getAgentConnectUrl: () => 'https://example.test/connect',
}));

import { act, fireEvent, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import TabsLayout from '../app/(tabs)/_layout';
import MoreScreen from '../app/(tabs)/more';

function SettingsStub() {
  const { source } = useLocalSearchParams<{ source?: string }>();
  return <Text testID="settings-stub">{`Settings from ${source ?? 'nowhere'}`}</Text>;
}

const stub = (testID: string) =>
  function Stub() {
    return <Text testID={testID}>{testID}</Text>;
  };

it('opens Settings from the More row, inside the tab shell with More still active', async () => {
  const router = renderRouter(
    {
      '(tabs)/_layout': TabsLayout,
      '(tabs)/today': stub('today-stub'),
      '(tabs)/train': stub('train-stub'),
      '(tabs)/progress': stub('progress-stub'),
      '(tabs)/more': MoreScreen,
      '(tabs)/stats-history': stub('stats-stub'),
      '(tabs)/exercise-catalog': stub('catalog-stub'),
      '(tabs)/groups': stub('groups-stub'),
      '(tabs)/settings': SettingsStub,
    },
    { initialUrl: '/more' }
  );
  expect(await screen.findByTestId('more-screen')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('more-settings-row'));
  });

  expect(await screen.findByTestId('settings-stub')).toHaveTextContent('Settings from more');
  expect(router.getPathname()).toBe('/settings');
  expect(screen.getByTestId('top-level-tab-more')).toHaveProp(
    'accessibilityState',
    expect.objectContaining({ selected: true })
  );
});
