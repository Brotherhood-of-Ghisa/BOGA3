/* eslint-disable import/first */

import type { LogRecord } from '@/src/logging';

const mockGetRecentLogs = jest.fn<LogRecord[], []>();

jest.mock('@/src/logging', () => ({
  getRecentLogs: () => mockGetRecentLogs(),
  clearRecentLogs: jest.fn(),
  subscribeToLogs: () => () => undefined,
}));
jest.mock('@/src/utils/isDevMode', () => ({ isDevMode: () => true }));

import { fireEvent, screen } from '@testing-library/react-native';

import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';
import DevLogsScreen from '../app/dev-logs';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// The tab and detail routes under `app/` follow a saved appearance. The dev
// log viewer stands for them: its level tones come from the live text roles
// and its context dump's rule from a live `makeStyles` sheet.

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };

const record = (seq: number, level: LogRecord['level'], extra: Partial<LogRecord> = {}): LogRecord => ({
  seq,
  createdAt: '2026-10-27T10:05:12.000Z',
  level,
  source: 'sync',
  event: `event_${seq}`,
  message: null,
  userId: null,
  clientPlatform: 'ios',
  clientAppVersion: null,
  clientBuildNumber: null,
  ...extra,
} as LogRecord);

describe('the app routes on a saved appearance', () => {
  it('repaints the dev log viewer when the appearance changes', async () => {
    mockGetRecentLogs.mockReturnValue([record(1, 'info', { context: { attempt: 2 } }), record(2, 'error')]);
    renderWithTheme(<DevLogsScreen />);
    fireEvent.press(screen.getByTestId('dev-logs-row-1'));

    const before = rolesFor(DEFAULT_APPEARANCE);
    const after = rolesFor(SLATE_DARK);
    expect(after.danger).not.toBe(before.danger);
    expect(after.ruleSoft).not.toBe(before.ruleSoft);
    expect(screen.getByText('ERROR')).toHaveStyle({ color: before.danger });
    expect(screen.getByText(/"attempt": 2/)).toHaveStyle({ borderTopColor: before.ruleSoft });

    await switchTheme(SLATE_DARK);

    expect(screen.getByText('ERROR')).toHaveStyle({ color: after.danger });
    expect(screen.getByText(/"attempt": 2/)).toHaveStyle({ borderTopColor: after.ruleSoft });
  });
});
