/* eslint-disable import/first */

/**
 * Outcome: the developer-only wipe affordances are gated on the cross-build dev
 * signal, not the bare metro-only `__DEV__` global.
 *
 * Two buttons (wipe-local, wipe-remote-for-me) live on Settings → Developer
 * tools, behind a dev gate on both the Settings card that opens the page and
 * the page itself. They must be hidden in a release build and shown in a dev
 * build — and the gate must use the helper that stays true in the internally
 * distributed developer build (where `__DEV__` is false), so a bare `__DEV__`
 * guard would wrongly hide the tools on the very build that needs them.
 *
 * This file asserts:
 *
 *   1. With the dev signal false, the Everything else page (reached in every
 *      build, for its Developer mode switch) renders neither wipe button (nor
 *      the other dev rows).
 *   2. With the dev signal true, the page renders the dev rows, both wipe
 *      buttons among them.
 *   3. The Settings screen, Everything else page and wipe-helper sources contain no bare
 *      `__DEV__` token used as a runtime guard (only the helper's own
 *      explanatory comments may mention it).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const mockPush = jest.fn();
const mockIsDevMode = jest.fn();
const mockUseAuth = jest.fn();

// Weight entry has its own feature suite; keep this suite on dev visibility.
jest.mock('@/components/bodyweight/settings-row', () => ({ BodyWeightSettingsRow: () => null }));

jest.mock('expo-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- resolve after mock hoisting.
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]),
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/src/utils/isDevMode', () => ({
  isDevMode: () => mockIsDevMode(),
}));

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

// The sync-status panel has its own spec; stub it so this dev-gate suite stays
// focused on the wipe affordances.
jest.mock('@/components/sync-status/sync-status-panel', () => ({
  SyncStatusPanel: () => null,
}));

jest.mock('@/src/data', () => ({
  resetLocalDataAndReseed: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/src/sync/dev-affordances', () => ({
  resetAndReseedLocalData: jest.fn(() => Promise.resolve()),
  wipeLocalAndReBootstrap: jest.fn(() => Promise.resolve()),
  wipeRemoteForCurrentUser: jest.fn(() => Promise.resolve({ rowsDeleted: 0 })),
}));

import { render, screen } from '@testing-library/react-native';

import EverythingElseRoute from '../../app/settings-everything-else';

const MOBILE_ROOT = join(__dirname, '..', '..');
const SETTINGS_PATH = join(MOBILE_ROOT, 'app', 'settings.tsx');
const DEVELOPER_TOOLS_PATH = join(MOBILE_ROOT, 'components', 'settings', 'everything-else.tsx');
const DEV_AFFORDANCES_PATH = join(MOBILE_ROOT, 'src', 'sync', 'dev-affordances.ts');

beforeEach(() => {
  mockPush.mockReset();
  mockIsDevMode.mockReset();
  // Signed-in user so the screen renders; the panel itself is stubbed above.
  mockUseAuth.mockReset().mockReturnValue({ user: { id: 'user-1', email: 'u@test' } });
});

describe('the dev gate on the wipe affordances', () => {
  it('renders neither wipe button when the dev signal is false', () => {
    mockIsDevMode.mockReturnValue(false);

    render(<EverythingElseRoute />);
    expect(screen.getByTestId('settings-developer-mode-switch')).toBeTruthy();
    expect(screen.queryByTestId('settings-dev-logs-button')).toBeNull();
    expect(screen.queryByTestId('settings-dev-wipe-local-button')).toBeNull();
    expect(screen.queryByTestId('settings-dev-wipe-remote-button')).toBeNull();
  });

  it('renders both wipe buttons when the dev signal is true', () => {
    mockIsDevMode.mockReturnValue(true);

    render(<EverythingElseRoute />);
    expect(screen.getByTestId('settings-developer-mode-switch')).toBeTruthy();
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
    ['Everything else page', DEVELOPER_TOOLS_PATH],
    ['wipe helper', DEV_AFFORDANCES_PATH],
  ];

  it.each(targets)('the %s source uses no bare __DEV__ runtime guard', (_label, path) => {
    const code = stripComments(readFileSync(path, 'utf8'));
    expect(code.includes('__DEV__')).toBe(false);
  });

  it('the Everything else page gates on the dev-mode helper', () => {
    expect(readFileSync(DEVELOPER_TOOLS_PATH, 'utf8')).toContain('isDevMode');
  });
});
