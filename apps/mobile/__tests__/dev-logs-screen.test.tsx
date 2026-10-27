/* eslint-disable import/first */

import type { LogRecord } from '@/src/logging';

const mockGetRecentLogs = jest.fn<LogRecord[], []>();
const mockClearRecentLogs = jest.fn();
const mockIsDevMode = jest.fn(() => true);

jest.mock('@/src/logging', () => ({
  getRecentLogs: () => mockGetRecentLogs(),
  clearRecentLogs: () => mockClearRecentLogs(),
  subscribeToLogs: () => () => undefined,
}));
jest.mock('@/src/utils/isDevMode', () => ({ isDevMode: () => mockIsDevMode() }));

import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { uiFonts, uiRoles, uiText } from '@/components/ui';
import DevLogsScreen from '../app/dev-logs';

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

const role = (name: keyof typeof uiText) => StyleSheet.flatten(uiText[name]);

describe('Dev logs screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsDevMode.mockReturnValue(true);
    mockGetRecentLogs.mockReturnValue([
      record(1, 'debug'),
      record(2, 'info'),
      record(3, 'warn'),
      record(4, 'error', { message: 'Push failed.', context: { attempt: 2 } }),
    ]);
  });

  it('draws each level as a micro-label in its own tone; only an error takes a hue', () => {
    render(<DevLogsScreen />);

    expect(screen.getByText('ERROR')).toHaveStyle({ ...role('label'), color: uiRoles.danger });
    expect(screen.getByText('WARN')).toHaveStyle({ ...role('label'), color: uiRoles.ink });
    expect(screen.getByText('INFO')).toHaveStyle({ ...role('label'), color: uiRoles.inkMuted });
    expect(screen.getByText('DEBUG')).toHaveStyle({ ...role('label'), color: uiRoles.inkFaint });
  });

  it('takes the row name, message and hint from the roles, and keeps the context dump in Plex Mono', () => {
    render(<DevLogsScreen />);
    const row = within(screen.getByTestId('dev-logs-row-4'));

    expect(row.getByText('sync · event_4')).toHaveStyle(role('bodyStrong'));
    expect(row.getByText('Push failed.')).toHaveStyle({ ...role('body'), color: uiRoles.inkMuted });
    expect(row.getByText('Tap to show context')).toHaveStyle(role('meta'));

    fireEvent.press(screen.getByTestId('dev-logs-row-4'));
    expect(row.queryByText('Tap to show context')).toBeNull();
    expect(row.getByText(/"attempt": 2/)).toHaveStyle(role('figureSmall'));
  });

  it('draws the time as a meta line with its digits in the figure face', () => {
    render(<DevLogsScreen />);
    const line = screen.getByTestId('dev-logs-row-1-time');
    expect(line).toHaveTextContent(new Date('2026-10-27T10:05:12.000Z').toLocaleTimeString());

    expect(line).toHaveStyle(role('meta'));
    const digits = line.findAll((node) => node.type === 'Text' && node !== line);
    expect(digits.length).toBeGreaterThan(0);
    for (const digit of digits) expect(digit).toHaveStyle({ fontFamily: uiFonts.figure.family });
  });

  it('filters by level and clears the view', () => {
    render(<DevLogsScreen />);

    fireEvent.press(screen.getByTestId('dev-logs-filter-error'));
    expect(screen.queryByText('DEBUG')).toBeNull();
    expect(screen.getByText('ERROR')).toBeTruthy();

    fireEvent.press(screen.getByTestId('dev-logs-clear-button'));
    expect(mockClearRecentLogs).toHaveBeenCalled();
  });

  it('shows only a notice outside developer builds', () => {
    mockIsDevMode.mockReturnValue(false);
    render(<DevLogsScreen />);

    expect(screen.getByText('Log viewer is available in developer builds only.')).toBeTruthy();
    expect(screen.queryByTestId('dev-logs-list')).toBeNull();
  });
});
