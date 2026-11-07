import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';
import { useMemo } from 'react';

import type { ThemeMode, UiRoles } from '@/components/ui/theme';
import { useUiMode, useUiRoles } from '@/components/ui/theme-context';

/**
 * The navigators' theme in the given roles and mode. Without one,
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

// The navigators' theme in the roles and mode the app is drawn in now.
export function useNavigationTheme(): Theme {
  const roles = useUiRoles();
  const mode = useUiMode();
  return useMemo(() => navigationTheme(roles, mode), [roles, mode]);
}

// The status bar's content: dark on a light page, light on a dark one.
export function statusBarStyleFor(mode: ThemeMode): 'dark' | 'light' {
  return mode === 'dark' ? 'light' : 'dark';
}
