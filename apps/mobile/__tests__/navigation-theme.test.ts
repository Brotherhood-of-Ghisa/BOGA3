import { act } from '@testing-library/react-native';
import { DarkTheme, DefaultTheme } from 'expo-router';
import { Storage } from 'expo-sqlite/kv-store';
import { createElement } from 'react';
import { Appearance } from 'react-native';

import { navigationTheme, statusBarStyleFor, useNavigationTheme } from '@/components/navigation/navigation-theme';
import { defaultThemeSeeds, generateRoles } from '@/components/ui/theme';
import { APPEARANCE_STORAGE_KEY } from '@/components/ui/theme-launch';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';
import { serialiseAppearanceRecord } from '@/components/ui/theme-record';

import { renderWithTheme } from './helpers/theme';

// The navigators and the status bar take the roles and mode the app is drawn in, so what
// no screen paints — the ground behind a push, a default header, the clock —
// never falls back to React Navigation's or the OS's own light look.

describe('navigationTheme', () => {
  it.each(['light', 'dark'] as const)('draws the navigators in the %s roles', (mode) => {
    const roles = generateRoles(defaultThemeSeeds, mode);
    const theme = navigationTheme(roles, mode);
    expect(theme.dark).toBe(mode === 'dark');
    expect(theme.colors).toEqual({
      primary: roles.accent,
      background: roles.paper,
      card: roles.paper,
      text: roles.ink,
      border: roles.rule,
      notification: roles.danger,
    });
    expect(theme.fonts).toEqual((mode === 'dark' ? DarkTheme : DefaultTheme).fonts);
  });
});

describe('statusBarStyleFor', () => {
  it('draws dark content on a light page and light content on a dark one', () => {
    expect(statusBarStyleFor('light')).toBe('dark');
    expect(statusBarStyleFor('dark')).toBe('light');
  });
});

describe('useNavigationTheme', () => {
  it('follows the phone into dark while the saved mode is System', async () => {
    let phone: 'light' | 'dark' = 'light';
    const listeners = new Set<(preferences: { colorScheme: 'light' | 'dark' }) => void>();
    jest.spyOn(Appearance, 'getColorScheme').mockImplementation(() => phone);
    jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    jest.spyOn(Appearance, 'addChangeListener').mockImplementation((listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) } as ReturnType<typeof Appearance.addChangeListener>;
    });
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord({ ...DEFAULT_APPEARANCE, mode: 'system' }));
    const seen: ReturnType<typeof useNavigationTheme>[] = [];
    function Probe() {
      seen.push(useNavigationTheme());
      return null;
    }
    renderWithTheme(createElement(Probe));
    expect(seen[seen.length - 1].dark).toBe(false);

    phone = 'dark';
    await act(async () => listeners.forEach((listener) => listener({ colorScheme: 'dark' })));

    const dark = generateRoles(defaultThemeSeeds, 'dark');
    expect(seen[seen.length - 1]).toMatchObject({ dark: true, colors: { background: dark.paper, text: dark.ink } });
    jest.restoreAllMocks();
  });
});
