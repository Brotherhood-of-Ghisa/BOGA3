/* eslint-disable import/first */

jest.mock('@/src/auth', () => ({ useAuth: () => ({ isConfigured: true, session: { user: { id: 'user-1' } } }) }));
jest.mock('@/src/sync/scheduler', () => ({
  requestSync: jest.fn(),
  getSchedulerStatus: () => ({ progress: { phase: 'idle', layersCompleted: 0, rowsApplied: 0, offline: false } }),
}));

import { act, screen } from '@testing-library/react-native';
import { ActivityIndicator, StyleSheet, type TextStyle } from 'react-native';

import { ChoiceMeta } from '@/components/appearance/appearance-custom';
import { ApplyingIndicator } from '@/components/appearance/theme-header';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';
import { SyncSetupScreen, SYNC_GATE_TEST_IDS } from '@/src/sync/SyncGate';
import { __resetSyncGateStateForTests, publishSyncGateState } from '@/src/sync/sync-gate-state';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// Settings → Appearance and the sync gate repaint when a theme is saved. The
// previewed theme (`ThemePreview`, a swatch) is another theme's colours by
// design; what follows the saved theme is the screen around it.

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as TextStyle;

describe('Settings → Appearance and the sync gate: live theme', () => {
  afterEach(async () => {
    await switchTheme(DEFAULT_APPEARANCE);
    __resetSyncGateStateForTests();
  });

  it('repaints the applying indicator and a choice row’s words when the theme is saved', async () => {
    const before = rolesFor(DEFAULT_APPEARANCE);
    const after = rolesFor(SLATE_DARK);
    expect(after.ink).not.toBe(before.ink);

    renderWithTheme(
      <>
        <ApplyingIndicator applying testID="applying" />
        <ChoiceMeta details={['Default']} roles={before} />
      </>,
    );
    const spinner = () => screen.UNSAFE_getByType(ActivityIndicator);
    expect(spinner().props.color).toBe(before.inkMuted);
    expect(flat(screen.getByText('Default')).color).toBe(before.inkMuted);

    await switchTheme(SLATE_DARK);

    expect(spinner().props.color).toBe(after.inkMuted);
    expect(flat(screen.getByText('Default')).color).toBe(after.inkMuted);
  });

  it('repaints the sync gate’s error when the theme is saved', async () => {
    const before = rolesFor(DEFAULT_APPEARANCE);
    const after = rolesFor(SLATE_DARK);
    expect(after.danger).not.toBe(before.danger);

    renderWithTheme(<SyncSetupScreen />);
    act(() => {
      publishSyncGateState({
        bootstrapCompletedAt: null,
        lastCycleErrorCode: 'INTERNAL',
        lastCycleErrorDetail: null,
        localDataOwnerId: null,
      });
    });
    expect(flat(screen.getByTestId(SYNC_GATE_TEST_IDS.errorMessage)).color).toBe(before.danger);

    await switchTheme(SLATE_DARK);

    expect(flat(screen.getByTestId(SYNC_GATE_TEST_IDS.errorMessage)).color).toBe(after.danger);
  });
});
