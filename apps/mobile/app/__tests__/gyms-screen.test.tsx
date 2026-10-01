/* eslint-disable import/first */

/**
 * The Gyms screen over real data: the production screen, gym directory and
 * local-gyms repository over the migrated in-memory SQLite database
 * (helpers/local-data.ts). One synced gym with a saved location is seeded
 * through the repository; every write is read back from the `gyms` table.
 *
 * Replaced: the native database open, the router, and the position read the
 * screen takes as a prop (the simulator cannot fake a location). A failed
 * location write and a failed gyms read are forced once on the real module
 * with `jest.spyOn`.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockDismissTo = jest.fn();
const mockReplace = jest.fn();
let mockSearchParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ dismissTo: mockDismissTo, replace: mockReplace }),
}));

import { GymsScreen } from '@/components/gyms';
import GymsRoute from '../gyms';
import * as localGyms from '@/src/data/local-gyms';
import { gyms } from '@/src/data/schema';
import { bootLocalApp, closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';

const FIX = {
  status: 'success' as const,
  position: { latitude: 51.501, longitude: -0.141, accuracyM: 20, capturedAt: new Date('2026-09-23T10:00:00Z') },
};
const SYNCED_LOCATION = { latitude: 51.5, longitude: -0.12, accuracyM: 12, updatedAt: new Date('2026-09-01T10:00:00Z') };

const readPosition = jest.fn();

const gymRow = (id: string) => localDatabase().select().from(gyms).where(eq(gyms.id, id)).get();
const locationOf = (id: string) => {
  const row = gymRow(id);
  return row
    ? { latitude: row.latitude, longitude: row.longitude, accuracyM: row.coordinateAccuracyM }
    : undefined;
};
const allGymRows = () => localDatabase().select({ id: gyms.id, name: gyms.name }).from(gyms).all();

const seed = async () => {
  // A gym that arrived by sync, with its saved location.
  await localGyms.upsertLocalGym({ id: 'synced-strength-house', name: 'Synced Strength House', coordinates: SYNCED_LOCATION });
  await bootLocalApp();
};

const renderScreen = async () => {
  await seed();
  render(<GymsScreen readPosition={readPosition} />);
  await screen.findByTestId('gyms-list');
};

const openEditor = async (name: string) => {
  fireEvent.press(screen.getByLabelText(`Edit gym ${name}`));
  await screen.findByTestId('gym-editor');
};

const gymNamesInOrder = () =>
  screen
    .getAllByLabelText(/^Edit gym /)
    .map((node) => String(node.props.accessibilityLabel).replace('Edit gym ', ''));

beforeEach(() => {
  resetLocalData();
  mockSearchParams = {};
  mockDismissTo.mockReset();
  mockReplace.mockReset();
  readPosition.mockReset().mockResolvedValue(FIX);
});

afterEach(() => {
  jest.restoreAllMocks();
  closeLocalData();
});

describe('Gyms screen over real data', () => {
  it('lists the seeded gyms first, then local ones, with whether each has a saved location', async () => {
    await renderScreen();

    expect(gymNamesInOrder()).toEqual([
      'Downtown Iron Temple',
      'Westside Barbell Club',
      'North End Strength Lab',
      'Synced Strength House',
    ]);
    expect(screen.getByTestId('gyms-row-synced-strength-house-status')).toHaveTextContent('Location saved');
    expect(screen.getByTestId('gyms-row-downtown-iron-temple-status')).toHaveTextContent('No location saved');
    // Latitude and longitude stay private: the list shows presence only.
    expect(screen.queryByText(/51\.5/)).toBeNull();
    expect(screen.queryByTestId('gyms-toggle-archived')).toBeNull();
  });

  it('adds a gym under a new custom id, without reading the location unless asked', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('gyms-add'));
    expect(screen.getByTestId('gym-editor-save')).toBeDisabled();
    fireEvent.changeText(screen.getByTestId('gym-editor-name'), '  Southside Fitness Forge ');
    await act(async () => {
      fireEvent.press(screen.getByTestId('gym-editor-save'));
    });

    expect(readPosition).not.toHaveBeenCalled();
    const added = allGymRows().find((row) => row.name === 'Southside Fitness Forge');
    expect(added?.id).toMatch(/^custom-southside-fitness-forge-\d+$/);
    expect(locationOf(added!.id)).toEqual({ latitude: null, longitude: null, accuracyM: null });
    expect(screen.queryByTestId('gym-editor')).toBeNull();
    expect(await screen.findByText('Southside Fitness Forge')).toBeTruthy();
  });

  it('adds a gym with the location staged in its editor', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('gyms-add'));
    fireEvent.changeText(screen.getByTestId('gym-editor-name'), 'Southside Fitness Forge');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save current location for new gym'));
    });

    expect(screen.getByTestId('gym-editor-location-status')).toHaveTextContent('Location ready');
    expect(screen.getByTestId('gym-editor-feedback')).toHaveTextContent('Location ready. It saves when you add the gym.');
    // Staged, not written: the gym does not exist yet.
    expect(allGymRows().map((row) => row.name)).not.toContain('Southside Fitness Forge');

    await act(async () => {
      fireEvent.press(screen.getByTestId('gym-editor-save'));
    });

    const added = allGymRows().find((row) => row.name === 'Southside Fitness Forge');
    expect(locationOf(added!.id)).toEqual({ latitude: 51.501, longitude: -0.141, accuracyM: 20 });
  });

  it('renames a seeded gym, writing its row, and a located gym without touching its location', async () => {
    await renderScreen();

    await openEditor('Downtown Iron Temple');
    fireEvent.changeText(screen.getByDisplayValue('Downtown Iron Temple'), 'Downtown Iron Works');
    await act(async () => {
      fireEvent.press(screen.getByTestId('gym-editor-save'));
    });

    expect(gymRow('downtown-iron-temple')).toMatchObject({ name: 'Downtown Iron Works' });
    // The written seed row wins over the seed.
    expect(await screen.findByLabelText('Edit gym Downtown Iron Works')).toBeTruthy();
    expect(screen.queryByLabelText('Edit gym Downtown Iron Temple')).toBeNull();

    await openEditor('Synced Strength House');
    fireEvent.changeText(screen.getByDisplayValue('Synced Strength House'), 'Synced Strength Hall');
    await act(async () => {
      fireEvent.press(screen.getByTestId('gym-editor-save'));
    });

    expect(gymRow('synced-strength-house')).toMatchObject({ name: 'Synced Strength Hall' });
    expect(locationOf('synced-strength-house')).toEqual({ latitude: 51.5, longitude: -0.12, accuracyM: 12 });
  });

  it('cancels an edit without writing', async () => {
    await renderScreen();

    await openEditor('Downtown Iron Temple');
    fireEvent.changeText(screen.getByDisplayValue('Downtown Iron Temple'), 'Something Else');
    fireEvent.press(screen.getByTestId('gym-editor-cancel'));

    expect(screen.queryByTestId('gym-editor')).toBeNull();
    expect(screen.getByLabelText('Edit gym Downtown Iron Temple')).toBeTruthy();
    expect(gymRow('downtown-iron-temple')).toBeUndefined();
  });

  it('saves the current location from the editor, keeping it open', async () => {
    await renderScreen();

    await openEditor('Downtown Iron Temple');
    expect(screen.getByTestId('gym-editor-location-status')).toHaveTextContent('No location saved');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save current location for gym Downtown Iron Temple'));
    });

    expect(gymRow('downtown-iron-temple')).toMatchObject({ name: 'Downtown Iron Temple' });
    expect(locationOf('downtown-iron-temple')).toEqual({ latitude: 51.501, longitude: -0.141, accuracyM: 20 });
    expect(screen.getByTestId('gym-editor-feedback')).toHaveTextContent('Location saved.');
    await waitFor(() => expect(screen.getByTestId('gym-editor-location-status')).toHaveTextContent('Location saved'));
    // With a location saved, the editor offers Replace and Clear instead.
    expect(screen.getByTestId('gym-editor-location-replace')).toBeTruthy();
    expect(screen.getByTestId('gym-editor-location-clear')).toBeTruthy();
  });

  it('asks before replacing a saved location', async () => {
    await renderScreen();

    await openEditor('Synced Strength House');
    fireEvent.press(screen.getByLabelText('Replace location for gym Synced Strength House'));

    expect(screen.getByText('Replace the saved location with where you are now?')).toBeTruthy();
    expect(readPosition).not.toHaveBeenCalled();
    expect(locationOf('synced-strength-house')).toEqual({ latitude: 51.5, longitude: -0.12, accuracyM: 12 });

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Confirm replace location for gym Synced Strength House'));
    });

    expect(locationOf('synced-strength-house')).toEqual({ latitude: 51.501, longitude: -0.141, accuracyM: 20 });
    expect(screen.getByTestId('gym-editor-feedback')).toHaveTextContent('Location replaced.');
  });

  it('asks before clearing a saved location, and a cancel changes nothing', async () => {
    await renderScreen();

    await openEditor('Synced Strength House');
    fireEvent.press(screen.getByLabelText('Clear location for gym Synced Strength House'));
    expect(screen.getByText("Clear the saved location? This gym won't be suggested nearby.")).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Cancel location change for gym Synced Strength House'));
    expect(screen.queryByTestId('gym-editor-confirm')).toBeNull();
    expect(locationOf('synced-strength-house')).toEqual({ latitude: 51.5, longitude: -0.12, accuracyM: 12 });

    fireEvent.press(screen.getByLabelText('Clear location for gym Synced Strength House'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Confirm clear location for gym Synced Strength House'));
    });

    expect(locationOf('synced-strength-house')).toEqual({ latitude: null, longitude: null, accuracyM: null });
    expect(screen.getByTestId('gym-editor-feedback')).toHaveTextContent(
      "Location cleared. This gym won't be suggested nearby."
    );
    await waitFor(() => expect(screen.getByTestId('gym-editor-location-status')).toHaveTextContent('No location saved'));
  });

  it.each([
    ['permission denial', { status: 'permission_denied', canAskAgain: false }, 'Location permission was denied. Nothing changed.'],
    ['services off', { status: 'unavailable', reason: 'services_disabled' }, 'Location services are off. Nothing changed.'],
    ['a read failure', { status: 'read_failure', error: new Error('gps') }, "Couldn't read your location. Nothing changed."],
    [
      'low accuracy',
      { status: 'success', position: { ...FIX.position, accuracyM: 140 } },
      'Location accuracy is too low right now. Nothing changed.',
    ],
  ])('keeps %s inline and writes nothing', async (_case, result, message) => {
    readPosition.mockResolvedValue(result);
    await renderScreen();

    await openEditor('Downtown Iron Temple');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save current location for gym Downtown Iron Temple'));
    });

    expect(screen.getByTestId('gym-editor-feedback')).toHaveTextContent(message);
    expect(gymRow('downtown-iron-temple')).toBeUndefined();
    expect(screen.getByTestId('gym-editor-location-status')).toHaveTextContent('No location saved');
  });

  it('keeps a failed location write inline without marking the location saved (a failed write)', async () => {
    await renderScreen();
    jest.spyOn(localGyms, 'upsertLocalGym').mockRejectedValueOnce(new Error('database unavailable'));

    await openEditor('Downtown Iron Temple');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save current location for gym Downtown Iron Temple'));
    });

    expect(screen.getByTestId('gym-editor-feedback')).toHaveTextContent("Couldn't save the location. Nothing changed.");
    expect(screen.getByTestId('gym-editor-location-status')).toHaveTextContent('No location saved');
    expect(gymRow('downtown-iron-temple')).toBeUndefined();
  });

  it('archives a seeded gym as a soft delete, writing its row first, and unarchives it from Show archived', async () => {
    await renderScreen();

    // A seeded gym never written gets its row first, so the archive sticks.
    await openEditor('Downtown Iron Temple');
    await act(async () => {
      fireEvent.press(screen.getByTestId('gym-editor-archive'));
    });

    expect(gymRow('downtown-iron-temple')).toMatchObject({ name: 'Downtown Iron Temple' });
    expect(gymRow('downtown-iron-temple')?.deletedAt).toBeInstanceOf(Date);
    await waitFor(() => expect(screen.queryByLabelText('Edit gym Downtown Iron Temple')).toBeNull());

    fireEvent.press(screen.getByTestId('gyms-toggle-archived'));
    expect(screen.getByTestId('gyms-toggle-archived')).toHaveTextContent('Hide archived');
    expect(screen.getByTestId('gyms-row-downtown-iron-temple-status')).toHaveTextContent('Archived');

    await openEditor('Downtown Iron Temple');
    await act(async () => {
      fireEvent.press(screen.getByTestId('gym-editor-unarchive'));
    });

    expect(gymRow('downtown-iron-temple')?.deletedAt).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('gyms-toggle-archived')).toBeNull());
    expect(screen.getByTestId('gyms-row-downtown-iron-temple-status')).toHaveTextContent('No location saved');
  });

  it('shows Back to More only when opened from More, and returns without stacking the tabs', async () => {
    await seed();
    render(<GymsRoute />);
    await screen.findByTestId('gyms-list');
    expect(screen.queryByTestId('back-to-more-button')).toBeNull();
    screen.unmount();

    mockSearchParams = { source: 'more' };
    render(<GymsRoute />);
    await screen.findByTestId('gyms-list');
    fireEvent.press(screen.getByTestId('back-to-more-button'));

    expect(mockDismissTo).toHaveBeenCalledWith('/more');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('offers a retry when the gyms read fails (a failed read)', async () => {
    jest.spyOn(localGyms, 'listLocalGymsIncludingArchived').mockRejectedValueOnce(new Error('disk'));
    await seed();
    render(<GymsScreen readPosition={readPosition} />);

    fireEvent.press(await screen.findByTestId('gyms-retry'));
    expect(await screen.findByTestId('gyms-list')).toBeTruthy();
    expect(screen.getByLabelText('Edit gym Synced Strength House')).toBeTruthy();
  });
});
