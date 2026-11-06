import { createContext, startTransition, useContext, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import type { ThemeMode, UiRoles } from '@/components/ui/theme';
import { launchOsScheme, launchTheme, readStoredTheme, subscribeThemeSaved } from '@/components/ui/theme-launch';
import { appearanceMode, appearanceRoles, type AppearanceChoice } from '@/components/ui/theme-presets';
import { logEvent } from '@/src/logging';

// The appearance the app is drawn in while it runs: the stored choice, its
// mode and the colour roles it resolves to. A component reads the roles and the
// mode through `useUiRoles()`, `useUiMode()` or a `makeStyles` sheet, never
// from a module constant, so a saved choice repaints it.
export type AppTheme = {
  appearance: AppearanceChoice;
  mode: ThemeMode;
  roles: UiRoles;
};

// The mode is resolved against the OS's mode as this launch found it: native
// UI stays pinned to the launch mode (`theme-launch.ts`), and while pinned
// the OS reports the pin, not the phone.
function resolveAppTheme(appearance: AppearanceChoice): AppTheme {
  const mode = appearanceMode(appearance, launchOsScheme);
  return { appearance, mode, roles: appearanceRoles(appearance, mode) };
}

// The theme a saved choice draws. Roles that resolve to the same colours keep
// the current roles object, so every cached sheet stays; a choice that changes
// nothing keeps the current theme and re-renders nothing.
function withAppearance(current: AppTheme, appearance: AppearanceChoice): AppTheme {
  const next = resolveAppTheme(appearance);
  if (next.mode !== current.mode || JSON.stringify(next.roles) !== JSON.stringify(current.roles)) return next;
  if (JSON.stringify(next.appearance) === JSON.stringify(current.appearance)) return current;
  return { ...current, appearance };
}

// The theme this launch is drawn in. What a component reads outside an
// `AppThemeProvider` (a test that renders it alone).
const launchAppTheme: AppTheme = resolveAppTheme(launchTheme.appearance);

const AppThemeContext = createContext<AppTheme>(launchAppTheme);

// The stored choice, or null, logged, when the store cannot be read; the app
// then stays in the theme it is drawn in.
function readSavedAppearance(): AppearanceChoice | null {
  try {
    return readStoredTheme().appearance;
  } catch (error) {
    void logEvent({
      level: 'error',
      event: 'theme.read_failed',
      message: 'Could not read the saved appearance; the app stays in the theme it is drawn in.',
      context: { error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}

// Holds the theme for everything below it: the stored choice when it mounts
// (the launch theme if the store cannot be read then), then each choice saved
// while the app runs (`subscribeThemeSaved`). Mounted once, by the root layout.
//
// A save repaints every mounted screen that reads the theme, the stack behind
// the current one included, which costs far more than the tap that saved it.
// So the repaint is a transition: the control that saved it answers at once,
// and those screens then change theme together in one commit.
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(() => withAppearance(launchAppTheme, readSavedAppearance() ?? launchAppTheme.appearance));
  useEffect(
    () =>
      subscribeThemeSaved(() => {
        const appearance = readSavedAppearance();
        if (appearance) startTransition(() => setTheme((current) => withAppearance(current, appearance)));
      }),
    [],
  );
  return <AppThemeContext.Provider value={theme}>{children}</AppThemeContext.Provider>;
}

// The colour roles the app is drawn in now (`docs/specs/ui/design-language.md`
// §2). What a prop takes when it wants a colour: `placeholderTextColor`, an
// svg `fill`, an `ActivityIndicator`'s `color`.
export function useUiRoles(): UiRoles {
  return useContext(AppThemeContext).roles;
}

// The mode the app is drawn in now: what a native surface takes when it is
// told a mode rather than a colour (the date picker, the status bar).
export function useUiMode(): ThemeMode {
  return useContext(AppThemeContext).mode;
}

// A module's stylesheet drawn in the current roles. Declare it where
// `StyleSheet.create` stood, and call the hook in the component:
//
//   const useStyles = makeStyles((roles) => ({ card: { backgroundColor: roles.surface } }));
//   function Card() { const styles = useStyles(); … }
//
// Each sheet is built once per set of roles, so a theme switch builds it once
// however many components use it, and it is the same object between switches.
// What `StyleSheet.create` takes: named view, text and image styles.
type NamedStyles = Parameters<typeof StyleSheet.create>[0];

export function makeStyles<S extends NamedStyles>(build: (roles: UiRoles) => S & NamedStyles): () => Readonly<S> {
  const sheets = new WeakMap<UiRoles, Readonly<S>>();
  const sheetFor = (roles: UiRoles): Readonly<S> => {
    const cached = sheets.get(roles);
    if (cached) return cached;
    const sheet = StyleSheet.create<S>(build(roles));
    sheets.set(roles, sheet);
    return sheet;
  };
  return function useStyles(): Readonly<S> {
    return sheetFor(useUiRoles());
  };
}
