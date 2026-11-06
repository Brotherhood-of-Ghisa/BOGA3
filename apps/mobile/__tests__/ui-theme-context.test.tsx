/* eslint-disable import/first */

const mockLogEvent = jest.fn();
jest.mock('@/src/logging', () => ({ logEvent: (...args: unknown[]) => mockLogEvent(...args) }));

import { act, render, screen } from '@testing-library/react-native';
import { Storage } from 'expo-sqlite/kv-store';
import { Suspense } from 'react';
import { Text } from 'react-native';

import type { UiRoles } from '@/components/ui/theme';
import { makeStyles, useUiMode, useUiRoles } from '@/components/ui/theme-context';
import { APPEARANCE_STORAGE_KEY, launchTheme, saveAppearance } from '@/components/ui/theme-launch';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';
import { serialiseAppearanceRecord } from '@/components/ui/theme-record';

import { requireWithReactCompiler } from './helpers/react-compiler';
import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// The theme the app is drawn in while it runs (`components/ui/theme-context.tsx`):
// the provider starts from the stored choice and follows every save, and a
// component reads it through `useUiRoles`, `useUiMode` or a `makeStyles` sheet.

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };
const FOREST_LIGHT: AppearanceChoice = { theme: 'forest', mode: 'light', custom: null };

let seen: { roles: UiRoles; mode: string }[] = [];
function Probe() {
  const roles = useUiRoles();
  const mode = useUiMode();
  seen.push({ roles, mode });
  return <Text testID="probe">{`${mode} ${roles.paper}`}</Text>;
}
const latest = () => seen[seen.length - 1];

beforeEach(() => {
  seen = [];
  mockLogEvent.mockClear();
});

describe('AppThemeProvider', () => {
  it('starts from the stored choice', () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(SLATE_DARK));
    renderWithTheme(<Probe />);
    expect(latest()).toEqual({ roles: rolesFor(SLATE_DARK), mode: 'dark' });
  });

  it('re-resolves the roles and the mode on every save', async () => {
    renderWithTheme(<Probe />);
    expect(latest()).toEqual({ roles: rolesFor(DEFAULT_APPEARANCE), mode: 'light' });

    await switchTheme(SLATE_DARK);
    expect(latest()).toEqual({ roles: rolesFor(SLATE_DARK), mode: 'dark' });
    expect(screen.getByTestId('probe')).toHaveTextContent(`dark ${rolesFor(SLATE_DARK).paper}`);

    await switchTheme(FOREST_LIGHT);
    expect(latest()).toEqual({ roles: rolesFor(FOREST_LIGHT), mode: 'light' });
  });

  it('keeps the same roles, and renders nothing, when a save changes nothing', async () => {
    renderWithTheme(<Probe />);
    await switchTheme(SLATE_DARK);
    const before = latest().roles;
    const renders = seen.length;

    await switchTheme(SLATE_DARK);
    expect(seen).toHaveLength(renders);
    expect(latest().roles).toBe(before);
  });

  it('keeps the same roles when a save resolves to the same colours', async () => {
    // System on a light launch draws exactly what Light draws.
    const systemOnLight: AppearanceChoice = { ...DEFAULT_APPEARANCE, mode: 'system' };
    expect(rolesFor(systemOnLight)).toEqual(rolesFor(DEFAULT_APPEARANCE));
    renderWithTheme(<Probe />);
    const before = latest().roles;

    await switchTheme(systemOnLight);
    expect(latest().roles).toBe(before);
  });

  it('starts in the launch theme, and logs, when the store cannot be read as it mounts', () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(SLATE_DARK));
    const read = jest.spyOn(Storage, 'getItemSync').mockImplementation(() => {
      throw new Error('disk gone');
    });
    try {
      renderWithTheme(<Probe />);
    } finally {
      read.mockRestore();
    }
    expect(latest()).toEqual({ roles: rolesFor(launchTheme.appearance), mode: 'light' });
    expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'theme.read_failed' }));
  });

  it('stays in the theme it is drawn in, and logs, when the saved choice cannot be read', async () => {
    renderWithTheme(<Probe />);
    const before = latest().roles;
    const read = jest.spyOn(Storage, 'getItemSync').mockImplementation(() => {
      throw new Error('disk gone');
    });
    try {
      await switchTheme(SLATE_DARK);
    } finally {
      read.mockRestore();
    }
    expect(latest().roles).toBe(before);
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', event: 'theme.read_failed', context: { error: 'disk gone' } }),
    );
  });

  it('repaints as a transition: a screen not ready for the new theme keeps the old one, never a fallback', async () => {
    // A suspended render in an urgent update would swap the screen for its
    // fallback; in a transition React keeps the committed screen until all of
    // it can change theme in one commit.
    let ready: () => void = () => {};
    const notReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let waiting = true;
    void notReady.then(() => {
      waiting = false;
    });
    function SlowScreen() {
      const roles = useUiRoles();
      if (roles.paper === rolesFor(SLATE_DARK).paper && waiting) throw notReady;
      return <Probe />;
    }
    renderWithTheme(
      <Suspense fallback={<Text testID="fallback">loading</Text>}>
        <SlowScreen />
      </Suspense>,
    );
    const launchText = `light ${rolesFor(DEFAULT_APPEARANCE).paper}`;

    await switchTheme(SLATE_DARK);
    expect(screen.queryByTestId('fallback')).toBeNull();
    expect(screen.getByTestId('probe')).toHaveTextContent(launchText);

    await act(async () => {
      ready();
      await notReady;
    });
    expect(screen.getByTestId('probe')).toHaveTextContent(`dark ${rolesFor(SLATE_DARK).paper}`);
  });

  it('stops following saves once unmounted', async () => {
    const { unmount } = renderWithTheme(<Probe />);
    unmount();
    const renders = seen.length;
    await saveAppearance(SLATE_DARK);
    expect(seen).toHaveLength(renders);
  });

  it('leaves a component outside any provider in the launch theme', async () => {
    render(<Probe />);
    expect(latest()).toEqual({ roles: rolesFor(launchTheme.appearance), mode: 'light' });
    await switchTheme(SLATE_DARK);
    expect(latest()).toEqual({ roles: rolesFor(launchTheme.appearance), mode: 'light' });
  });
});

describe('makeStyles', () => {
  // A fresh sheet declaration per test: sheets are cached per set of roles for
  // as long as the module lives.
  function declare() {
    const build = jest.fn((roles: UiRoles) => ({ card: { backgroundColor: roles.surface } }));
    const useStyles = makeStyles(build);
    const sheets: object[] = [];
    function Card({ testID }: { testID: string }) {
      const styles = useStyles();
      sheets.push(styles);
      return <Text style={styles.card} testID={testID}>card</Text>;
    }
    return { build, sheets, Card };
  }

  it('builds one sheet per set of roles, shared by every component, and a new one after a switch', async () => {
    const { build, sheets, Card } = declare();
    renderWithTheme(
      <>
        <Card testID="first" />
        <Card testID="second" />
      </>,
    );
    expect(build).toHaveBeenCalledTimes(1);
    expect(sheets[0]).toBe(sheets[1]);
    const launchSheet = sheets[0];

    await switchTheme(SLATE_DARK);
    expect(build).toHaveBeenCalledTimes(2);
    expect(build).toHaveBeenLastCalledWith(rolesFor(SLATE_DARK));
    const [first, second] = sheets.slice(-2);
    expect(first).toBe(second);
    expect(first).not.toBe(launchSheet);
    expect(screen.getByTestId('first')).toHaveStyle({ backgroundColor: rolesFor(SLATE_DARK).surface });
  });

  it('returns the same sheet across re-renders and remounts while the roles hold', () => {
    const { build, sheets, Card } = declare();
    const { rerender, unmount } = renderWithTheme(<Card testID="first" />);
    rerender(<Card testID="first" />);
    unmount();
    renderWithTheme(<Card testID="first" />);
    expect(sheets).toHaveLength(3);
    expect(new Set(sheets).size).toBe(1);
    expect(build).toHaveBeenCalledTimes(1);
  });
});

describe('a component drawn through the theme, compiled as the device runs it', () => {
  // Through the React Compiler, a read of a module value during render could be
  // cached and never repaint; the hooks must not be.
  const { ThemedCard } = requireWithReactCompiler<typeof import('./fixtures/themed-card')>(
    '__tests__/fixtures/themed-card.tsx',
  );

  it('repaints its sheet, its colour props and its mode on a switch', async () => {
    renderWithTheme(<ThemedCard title="Bench" />);
    const launch = rolesFor(DEFAULT_APPEARANCE);
    expect(screen.getByTestId('themed-card')).toHaveStyle({ backgroundColor: launch.surface, borderColor: launch.rule });
    expect(screen.getByTestId('themed-card-title')).toHaveStyle({ color: launch.ink });
    expect(screen.getByTestId('themed-card-spinner').props.color).toBe(launch.accent);

    await switchTheme(SLATE_DARK);
    const slate = rolesFor(SLATE_DARK);
    expect(slate.surface).not.toBe(launch.surface);
    expect(screen.getByTestId('themed-card')).toHaveStyle({ backgroundColor: slate.surface, borderColor: slate.rule });
    expect(screen.getByTestId('themed-card-title')).toHaveStyle({ color: slate.ink });
    expect(screen.getByTestId('themed-card-spinner').props.color).toBe(slate.accent);
    expect(screen.getByTestId('themed-card-spinner').props.accessibilityHint).toBe('dark');
  });
});
