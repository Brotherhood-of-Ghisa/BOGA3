import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { BackupPanel } from '@/components/settings/backup-panel';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import type { DatabaseBackups } from '@/src/backup/database-backups';
import type { Snapshot } from '@/src/backup/snapshots';
import { formatLocalDateTime } from '@/src/utils/local-time';

// Data & sync's Backups card over a fake backups object (the real one is
// `database-backups.test.ts`): the newest snapshot, the count, Export.

const snapshot = (takenAtMs: number): Snapshot => ({ name: `s-${takenAtMs}`, takenAtMs });

const fakeBackups = (initial: Snapshot[] = []) => {
  let snapshots = initial;
  const listeners = new Set<() => void>();
  const backups = {
    start: jest.fn(() => () => undefined),
    snapshotNow: jest.fn(),
    snapshotIfDue: jest.fn(),
    exportDatabase: jest.fn(async () => undefined),
    list: jest.fn(() => snapshots),
    subscribe: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  const publish = (next: Snapshot[]) => {
    snapshots = next;
    listeners.forEach((listener) => listener());
  };
  return { backups: backups as unknown as DatabaseBackups & typeof backups, publish };
};

it('shows Never and no saved backups before the first snapshot', () => {
  render(<BackupPanel backups={fakeBackups().backups} />);

  expect(screen.getByTestId('settings-backup-last')).toHaveTextContent('Never');
  expect(screen.getByTestId('settings-backup-count')).toHaveTextContent('0');
});

it('shows the newest snapshot in the date format and the count, updating after a snapshot', () => {
  const newest = new Date(2026, 9, 25, 9, 30).getTime();
  const { backups, publish } = fakeBackups([snapshot(newest), snapshot(newest - 86_400_000)]);
  render(<BackupPanel backups={backups} />);

  expect(screen.getByTestId('settings-backup-last')).toHaveTextContent(formatLocalDateTime(newest, 'DD-MM-YYYY'));
  expect(screen.getByTestId('settings-backup-count')).toHaveTextContent('2');

  const later = newest + 3_600_000;
  act(() => publish([snapshot(later), snapshot(newest), snapshot(newest - 86_400_000)]));

  expect(screen.getByTestId('settings-backup-last')).toHaveTextContent(formatLocalDateTime(later, 'DD-MM-YYYY'));
  expect(screen.getByTestId('settings-backup-count')).toHaveTextContent('3');
});

it('draws the card on the text roles: a label, body row names, values as meta with figures in Plex Mono', () => {
  const newest = new Date(2026, 9, 25, 9, 30).getTime();
  render(<BackupPanel backups={fakeBackups([snapshot(newest)]).backups} />);

  expect(screen.getByText('Backups')).toHaveStyle({ fontFamily: uiFonts.display.family, fontSize: uiTypography.size.xxs, textTransform: 'uppercase' });
  expect(screen.getByText('Last backup')).toHaveStyle({ fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.base });
  const last = screen.getByTestId('settings-backup-last');
  expect(last).toHaveStyle({ fontFamily: uiFonts.body.family, fontSize: uiTypography.size.sm, color: uiRoles.ink });
  expect(within(last).getByText('25-10-2026')).toHaveStyle({ fontFamily: uiFonts.figure.family, fontWeight: '500' });
});

it('draws Unavailable as a word, not in the figure face', () => {
  const { backups } = fakeBackups();
  backups.list.mockImplementation(() => {
    throw new Error('no access');
  });
  render(<BackupPanel backups={backups} />);
  expect(screen.getByTestId('settings-backup-count')).toHaveStyle({ fontFamily: uiFonts.body.family });
});

it('shows Unavailable when the backups directory cannot be read', () => {
  const { backups } = fakeBackups();
  backups.list.mockImplementation(() => {
    throw new Error('no access');
  });
  render(<BackupPanel backups={backups} />);

  expect(screen.getByTestId('settings-backup-last')).toHaveTextContent('Never');
  expect(screen.getByTestId('settings-backup-count')).toHaveTextContent('Unavailable');
});

it('exports, disabling the button while the share sheet is open', async () => {
  const { backups } = fakeBackups();
  let finish!: () => void;
  backups.exportDatabase.mockImplementation(() => new Promise<undefined>((resolve) => (finish = () => resolve(undefined))));
  render(<BackupPanel backups={backups} />);

  fireEvent.press(screen.getByTestId('settings-backup-export-button'));

  expect(backups.exportDatabase).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('settings-backup-export-button')).toHaveTextContent('Exporting…');
  expect(screen.getByTestId('settings-backup-export-button')).toBeDisabled();
  await act(async () => finish());
  expect(screen.getByTestId('settings-backup-export-button')).toHaveTextContent('Export database');
  expect(screen.queryByTestId('settings-backup-error')).toBeNull();
});

it('shows why an export failed, and clears it on the next try', async () => {
  const { backups } = fakeBackups();
  backups.exportDatabase.mockRejectedValueOnce(new Error('Sharing is unavailable on this device.'));
  render(<BackupPanel backups={backups} />);

  fireEvent.press(screen.getByTestId('settings-backup-export-button'));
  await waitFor(() =>
    expect(screen.getByTestId('settings-backup-error')).toHaveTextContent('Sharing is unavailable on this device.'),
  );

  fireEvent.press(screen.getByTestId('settings-backup-export-button'));
  await waitFor(() => expect(screen.getByTestId('settings-backup-export-button')).toHaveTextContent('Export database'));
  expect(screen.queryByTestId('settings-backup-error')).toBeNull();
});

it('stops listening when it unmounts', () => {
  const { backups } = fakeBackups();
  const { unmount } = render(<BackupPanel backups={backups} />);
  const unsubscribe = backups.subscribe.mock.results[0].value as () => boolean;
  unmount();
  expect(unsubscribe()).toBe(false);
});
