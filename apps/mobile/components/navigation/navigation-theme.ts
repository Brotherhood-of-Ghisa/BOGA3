import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';

import type { ThemeMode, UiRoles } from '@/components/ui/theme';
import { uiMode, uiRoles } from '@/components/ui/tokens';

/**
 * The navigators' theme in this launch's roles and mode. Without one,
 * React Navigation draws what no screen paints (the ground behind a push, a
 * sheet's backdrop card, a default header) in its own fixed light greys.
 */
export function navigationTheme(roles: UiRoles, mode: ThemeMode): Theme {
  const base = mode === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: mode === 'dark',
    colors: {
      primary: roles.accent,
      background: roles.paper,
      card: roles.paper,
      text: roles.ink,
      border: roles.rule,
      notification: roles.danger,
    },
  };
}

export const NAVIGATION_THEME = navigationTheme(uiRoles, uiMode);

// The status bar's content: dark on a light page, light on a dark one.
export function statusBarStyleFor(mode: ThemeMode): 'dark' | 'light' {
  return mode === 'dark' ? 'light' : 'dark';
}
