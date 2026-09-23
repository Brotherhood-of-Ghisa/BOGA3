/* eslint-disable import/first */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockDismissTo = jest.fn();
const mockReplace = jest.fn();
let mockSearchParams: Record<string, string> = {};

jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(() => callback(), [callback]);
    },
    useLocalSearchParams: () => mockSearchParams,
    useRouter: () => ({ dismissTo: mockDismissTo, replace: mockReplace }),
  };
});

jest.mock('@/src/data', () => ({
  listLocalGymsIncludingArchived: jest.fn(),
  setLocalGymArchived: jest.fn(),
  upsertLocalGym: jest.fn(),
}));

import { GymsScreen } from '@/components/gyms';
import GymsRoute from '../gyms';

const data = jest.requireMock('@/src/data') as Record<string, jest.Mock>;

type Row = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  coordinateAccuracyM: number | null;
  coordinatesUpdatedAt: Date | null;
  archivedAt: Date | null;
};

const gymRow = (
  id: string,
  name: string,
  coordinates: { latitude: number; longitude: number } | null = null,
  archivedAt: Date | null = null
): Row => ({
  id,
  name,
  latitude: coordinates?.latitude ?? null,
  longitude: coordinates?.longitude ?? null,
  coordinateAccuracyM: coordinates ? 12 : null,
  coordinatesUpdatedAt: coordinates ? new Date('2026-09-01T10:00:00Z') : null,
  archivedAt,
});

const FIX = {
  status: 'success' as const,
  position: { latitude: 51.501, longitude: -0.141, accuracyM: 20, capturedAt: new Date('2026-09-23T10:00:00Z') },
};
const FIX_COORDINATES = { latitude: 51.501, longitude: -0.141, accuracyM: 20, updatedAt: new Date('2026-09-23T10:00:00Z') };

// A tiny in-memory gyms table behind the mocked data layer, so writes read back.
let rows: Row[];
const readPosition = jest.fn();

const renderScreen = async () => {
  render(<GymsScreen readPosition={readPosition} />);
  await screen.findByTestId('gyms-list');
};

const openEditor = async (name: string) => {
  fireEvent.press(screen.getByLabelText(`Edit gym ${name}`));
  await screen.findByTestId('gym-editor');
};

describe('Gyms screen', () => {
  beforeEach(() => {
    mockSearchParams = {};
    mockDismissTo.mockReset();
    mockReplace.mockReset();
    readPosition.mockReset().mockResolvedValue(FIX);
    rows = [gymRow('synced-strength-house', 'Synced Strength House', { latitude: 51.5, longitude: -0.12 })];
    data.listLocalGymsIncludingArchived.mockReset().mockImplementation(async () => rows.map((row) => ({ ...row })));
    data.upsertLocalGym.mockReset().mockImplementation(async (input: {
      id: string;
      name: string;
      coordinates?: typeof FIX_COORDINATES | null;
    }) => {
      const existing = rows.find((row) => row.id === input.id);
      const next: Row = existing ?? gymRow(input.id, input.name);
      next.name = input.name;
      if (input.coordinates !== undefined) {
        next.latitude = input.coordinates?.latitude ?? null;
        next.longitude = input.coordinates?.longitude ?? null;
        next.coordinateAccuracyM = input.coordinates?.accuracyM ?? null;
        next.coordinatesUpdatedAt = input.coordinates?.updatedAt ?? null;
      }
      if (!existing) rows.push(next);
    });
    data.setLocalGymArchived.mockReset().mockImplementation(async ({ id, archived }: { id: string; archived: boolean }) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) throw new Error('missing');
      row.archivedAt = archived ? new Date('2026-09-23T11:00:00Z') : null;
    });
  });

  it('lists the seeded and local gyms with whether each has a saved location', async () => {
    await renderScreen();

    expect(screen.getByLabelText('Edit gym Downtown Iron Temple')).toBeTruthy();
    expect(screen.getByLabelText('Edit gym Westside Barbell Club')).toBeTruthy();
    expect(screen.getByLabelText('Edit gym North End Strength Lab')).toBeTruthy();
    expect(screen.getByTestId('gyms-row-synced-strength-house-status')).toHaveTextContent('Location saved');
    expect(screen.getByTestId('gyms-row-downtown-iron-temple-status')).toHaveTextContent('No location saved');
    // Latitude and longitude stay private: the list shows presence only.
    expect(screen.queryByText(/51\.5/)).toBeNull();
    expect(screen.queryByTestId('gyms-toggle-archived')).toBeNull();
  });

  it('adds a gym, without reading the location unless asked', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('gyms-add'));
    expect(screen.getByTestId('gym-editor-save')).toBeDisabled();
    fireEvent.changeText(screen.getByTestId('gym-editor-name'), '  Southside Fitness Forge ');
    await act(async () => {
      fireEvent.press(screen.getByTestId('gym-editor-save'));
    });

    expect(readPosition).not.toHaveBeenCalled();
    expect(data.upsertLocalGym).toHaveBeenCalledWith({
      id: expect.stringMatching(/^custom-southside-fitness-forge-\d+$/),
      name: 'Southside Fitness Forge',
      coordinates: null,
    });
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
    expect(data.upsertLocalGym).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId('gym-editor-save'));
    });

    expect(data.upsertLocalGym).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Southside Fitness Forge', coordinates: FIX_COORDINATES })
    );
  });

  it('renames a gym without touching its location', async () => {
    await renderScreen();

    await openEditor('Downtown Iron Temple');
    fireEvent.changeText(screen.getByDisplayValue('Downtown Iron Temple'), 'Downtown Iron Works');
    await act(async () => {
      fireEvent.press(screen.getByTestId('gym-editor-save'));
    });

    expect(data.upsertLocalGym).toHaveBeenCalledWith({ id: 'downtown-iron-temple', name: 'Downtown Iron Works' });
    expect(await screen.findByLabelText('Edit gym Downtown Iron Works')).toBeTruthy();
  });

  it('cancels an edit without writing', async () => {
    await renderScreen();

    await openEditor('Downtown Iron Temple');
    fireEvent.changeText(screen.getByDisplayValue('Downtown Iron Temple'), 'Something Else');
    fireEvent.press(screen.getByTestId('gym-editor-cancel'));

    expect(screen.queryByTestId('gym-editor')).toBeNull();
    expect(screen.getByLabelText('Edit gym Downtown Iron Temple')).toBeTruthy();
    expect(data.upsertLocalGym).not.toHaveBeenCalled();
  });

  it('saves the current location from the editor, keeping it open', async () => {
    await renderScreen();

    await openEditor('Downtown Iron Temple');
    expect(screen.getByTestId('gym-editor-location-status')).toHaveTextContent('No location saved');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save current location for gym Downtown Iron Temple'));
    });

    expect(data.upsertLocalGym).toHaveBeenCalledWith({
      id: 'downtown-iron-temple',
      name: 'Downtown Iron Temple',
      coordinates: FIX_COORDINATES,
    });
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
    expect(data.upsertLocalGym).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Confirm replace location for gym Synced Strength House'));
    });

    expect(data.upsertLocalGym).toHaveBeenCalledWith({
      id: 'synced-strength-house',
      name: 'Synced Strength House',
      coordinates: FIX_COORDINATES,
    });
    expect(screen.getByTestId('gym-editor-feedback')).toHaveTextContent('Location replaced.');
  });

  it('asks before clearing a saved location, and a cancel changes nothing', async () => {
    await renderScreen();

    await openEditor('Synced Strength House');
    fireEvent.press(screen.getByLabelText('Clear location for gym Synced Strength House'));
    expect(screen.getByText("Clear the saved location? This gym won't be suggested nearby.")).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Cancel location change for gym Synced Strength House'));
    expect(screen.queryByTestId('gym-editor-confirm')).toBeNull();
    expect(data.upsertLocalGym).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Clear location for gym Synced Strength House'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Confirm clear location for gym Synced Strength House'));
    });

    expect(data.upsertLocalGym).toHaveBeenCalledWith({
      id: 'synced-strength-house',
      name: 'Synced Strength House',
      coordinates: null,
    });
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
    expect(data.upsertLocalGym).not.toHaveBeenCalled();
    expect(screen.getByTestId('gym-editor-location-status')).toHaveTextContent('No location saved');
  });

  it('keeps a failed location write inline without marking the location saved', async () => {
    data.upsertLocalGym.mockRejectedValueOnce(new Error('database unavailable'));
    await renderScreen();

    await openEditor('Downtown Iron Temple');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save current location for gym Downtown Iron Temple'));
    });

    expect(screen.getByTestId('gym-editor-feedback')).toHaveTextContent("Couldn't save the location. Nothing changed.");
    expect(screen.getByTestId('gym-editor-location-status')).toHaveTextContent('No location saved');
  });

  it('archives a gym as a soft delete and unarchives it from Show archived', async () => {
    await renderScreen();

    // A seeded gym never written gets its row first, so the archive sticks.
    await openEditor('Downtown Iron Temple');
    await act(async () => {
      fireEvent.press(screen.getByTestId('gym-editor-archive'));
    });

    expect(data.upsertLocalGym).toHaveBeenCalledWith({ id: 'downtown-iron-temple', name: 'Downtown Iron Temple' });
    expect(data.setLocalGymArchived).toHaveBeenCalledWith({ id: 'downtown-iron-temple', archived: true });
    await waitFor(() => expect(screen.queryByLabelText('Edit gym Downtown Iron Temple')).toBeNull());

    fireEvent.press(screen.getByTestId('gyms-toggle-archived'));
    expect(screen.getByTestId('gyms-toggle-archived')).toHaveTextContent('Hide archived');
    expect(screen.getByTestId('gyms-row-downtown-iron-temple-status')).toHaveTextContent('Archived');

    await openEditor('Downtown Iron Temple');
    data.upsertLocalGym.mockClear();
    await act(async () => {
      fireEvent.press(screen.getByTestId('gym-editor-unarchive'));
    });

    expect(data.upsertLocalGym).not.toHaveBeenCalled();
    expect(data.setLocalGymArchived).toHaveBeenLastCalledWith({ id: 'downtown-iron-temple', archived: false });
    await waitFor(() => expect(screen.queryByTestId('gyms-toggle-archived')).toBeNull());
    expect(screen.getByTestId('gyms-row-downtown-iron-temple-status')).toHaveTextContent('No location saved');
  });

  it('shows Back to More only when opened from More, and returns without stacking the tabs', async () => {
    render(<GymsRoute />);
    await screen.findByTestId('gyms-list');
    expect(screen.queryByTestId('back-to-more-button')).toBeNull();
    screen.unmount();

    mockSearchParams = { source: 'more' };
    await renderScreen();
    fireEvent.press(screen.getByTestId('back-to-more-button'));

    expect(mockDismissTo).toHaveBeenCalledWith('/more');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('offers a retry when the gyms cannot be read', async () => {
    data.listLocalGymsIncludingArchived.mockRejectedValueOnce(new Error('disk'));
    render(<GymsScreen readPosition={readPosition} />);

    fireEvent.press(await screen.findByTestId('gyms-retry'));
    expect(await screen.findByTestId('gyms-list')).toBeTruthy();
  });
});
