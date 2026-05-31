/* eslint-disable import/first */

/**
 * Outcome: the developer-only wipe affordances are gated on the cross-build dev
 * signal, not the bare metro-only `__DEV__` global.
 *
 * Two buttons (wipe-local, wipe-remote-for-me) live on the Settings screen
 * behind a dev gate. They must be hidden in a release build and shown in a dev
 * build — and the gate must use the helper that stays true in the internally
 * distributed developer build (where `__DEV__` is false), so a bare `__DEV__`
 * guard would wrongly hide the tools on the very build that needs them.
 *
 * This file asserts:
 *
 *   1. With the dev signal false, the Settings screen renders neither wipe
 *      button (nor the dev-tools card).
 *   2. With the dev signal true, it renders both buttons.
 *   3. The Settings screen source and the wipe-helper source contain no bare
 *      `__DEV__` token used as a runtime guard (only the helper's own
 *      explanatory comments may mention it).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const mockPush = jest.fn();
const mockIsDevMode = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/src/utils/isDevMode', () => ({
  isDevMode: () => mockIsDevMode(),
}));

jest.mock('@/src/data', () => ({
  resetLocalDataAndReseed: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/src/sync/dev-affordances', () => ({
  wipeLocalAndReBootstrap: jest.fn(() => Promise.resolve()),
  wipeRemoteForCurrentUser: jest.fn(() => Promise.resolve({ rowsDeleted: 0 })),
}));

import { render, screen } from '@testing-library/react-native';

import SettingsRoute from '../../(tabs)/settings';

const MOBILE_ROOT = join(__dirname, '..', '..', '..');
const SETTINGS_PATH = join(MOBILE_ROOT, 'app', '(tabs)', 'settings.tsx');
const DEV_AFFORDANCES_PATH = join(MOBILE_ROOT, 'src', 'sync', 'dev-affordances.ts');

beforeEach(() => {
  mockPush.mockReset();
  mockIsDevMode.mockReset();
});

describe('the dev gate on the wipe affordances', () => {
  it('renders neither wipe button when the dev signal is false', () => {
    mockIsDevMode.mockReturnValue(false);

    render(<SettingsRoute />);

    expect(screen.queryByTestId('settings-dev-tools-card')).toBeNull();
    expect(screen.queryByTestId('settings-dev-wipe-local-button')).toBeNull();
    expect(screen.queryByTestId('settings-dev-wipe-remote-button')).toBeNull();
  });

  it('renders both wipe buttons when the dev signal is true', () => {
    mockIsDevMode.mockReturnValue(true);

    render(<SettingsRoute />);

    expect(screen.getByTestId('settings-dev-wipe-local-button')).toBeTruthy();
    expect(screen.getByTestId('settings-dev-wipe-remote-button')).toBeTruthy();
  });
});

describe('the affordances are not gated on the bare metro-only global', () => {
  // Strips line and block comments so an explanatory mention of the global in
  // prose does not register as a runtime guard.
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  const targets: [string, string][] = [
    ['Settings screen', SETTINGS_PATH],
    ['wipe helper', DEV_AFFORDANCES_PATH],
  ];

  it.each(targets)('the %s source uses no bare __DEV__ runtime guard', (_label, path) => {
    const code = stripComments(readFileSync(path, 'utf8'));
    expect(code.includes('__DEV__')).toBe(false);
  });

  it('the Settings screen gates on the dev-mode helper', () => {
    const source = readFileSync(SETTINGS_PATH, 'utf8');
    expect(source).toContain('isDevMode');
  });
});
