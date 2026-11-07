import { DarkTheme, DefaultTheme } from 'expo-router';

import { navigationTheme, statusBarStyleFor } from '@/components/navigation/navigation-theme';
import { defaultThemeSeeds, generateRoles } from '@/components/ui/theme';

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
