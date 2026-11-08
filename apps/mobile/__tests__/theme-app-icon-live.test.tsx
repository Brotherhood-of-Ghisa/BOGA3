/* eslint-disable import/first */
jest.mock('expo-alternate-app-icons', () => ({
  __esModule: true,
  supportsAlternateIcons: true,
  getAppIconName: jest.fn(),
  setAlternateAppIcon: jest.fn(),
}));
jest.mock('@/src/logging', () => ({ logEvent: jest.fn() }));

import { act } from '@testing-library/react-native';
import * as appIcons from 'expo-alternate-app-icons';
import { Storage } from 'expo-sqlite/kv-store';

import { useThemeAppIcon } from '@/components/appearance/theme-app-icon';
import { APPEARANCE_STORAGE_KEY } from '@/components/ui/theme-launch';
import { DEFAULT_APPEARANCE, startingCustom } from '@/components/ui/theme-presets';
import { serialiseAppearanceRecord } from '@/components/ui/theme-record';

import { renderWithTheme, switchTheme } from './helpers/theme';

// The launcher icon follows the theme the app is drawn in, without a relaunch
// (`docs/specs/ui/design-language.md` §2). The native boundary and its OS
// limits are `theme-app-icon.test.ts`; here, which theme it is asked for.

const settle = () => act(() => new Promise<void>((resolve) => setImmediate(resolve)));

function Icon() {
  useThemeAppIcon();
  return null;
}

beforeEach(() => {
  // October: the ordinary icons, not November's.
  jest.useFakeTimers({ now: new Date(2026, 9, 20), doNotFake: ['setImmediate'] });
  jest.mocked(appIcons.setAlternateAppIcon).mockResolvedValue(null);
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

it('requests the stored theme’s icon, then each saved theme’s, and nothing for a save that keeps the theme', async () => {
  jest.mocked(appIcons.getAppIconName).mockReturnValue(null);
  Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord({ theme: 'forest', mode: 'light', custom: null }));
  renderWithTheme(<Icon />);
  await settle();
  expect(jest.mocked(appIcons.setAlternateAppIcon).mock.calls).toEqual([['Forest']]);

  jest.mocked(appIcons.getAppIconName).mockReturnValue('Forest');
  await switchTheme({ theme: 'slate', mode: 'dark', custom: null });
  await settle();
  expect(jest.mocked(appIcons.setAlternateAppIcon).mock.calls).toEqual([['Forest'], ['Slate']]);

  jest.mocked(appIcons.getAppIconName).mockReturnValue('Slate');
  await switchTheme({ theme: 'slate', mode: 'light', custom: null });
  await settle();
  expect(appIcons.setAlternateAppIcon).toHaveBeenCalledTimes(2);
});

it('requests the Rainbow icon when Custom is saved, and stops asking once unmounted', async () => {
  jest.mocked(appIcons.getAppIconName).mockReturnValue(null);
  const view = renderWithTheme(<Icon />);
  await settle();
  expect(appIcons.setAlternateAppIcon).not.toHaveBeenCalled();

  await switchTheme({ theme: 'custom', mode: 'light', custom: startingCustom(DEFAULT_APPEARANCE, 'light') });
  await settle();
  expect(jest.mocked(appIcons.setAlternateAppIcon).mock.calls).toEqual([['Rainbow']]);

  view.unmount();
  await switchTheme({ theme: 'plum', mode: 'light', custom: null });
  await settle();
  expect(appIcons.setAlternateAppIcon).toHaveBeenCalledTimes(1);
});
