/* eslint-disable import/first */

/**
 * The body weight log and its Settings rows over real data: the production
 * screen, weight editor, reading repository and private calculation
 * preference over the migrated in-memory SQLite database
 * (helpers/local-data.ts). Only the native database open and the router are
 * replaced. Three tests force one rejection on the real module with
 * `jest.spyOn` — a failed reading save, a failed delete and a failed
 * preference write — the only states real data cannot produce.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
}));

import { BodyWeightScreen } from '@/components/bodyweight/body-weight-screen';
import { BodyWeightSettingsRow } from '@/components/bodyweight/settings-row';
import { __resetBodyweightCalculationPreferenceForTests } from '@/src/bodyweight/calculation-preference';
import * as bodyweightRepository from '@/src/data/bodyweight';
import { bodyWeightMeasurements, userSettings } from '@/src/data/schema';
import * as userSettingsRepository from '@/src/data/user-settings';
import { formatCurrentDateTime } from '@/src/session-recorder/session-model';
import { bootLocalApp, closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';

// A reading or preference write invalidates the exercise catalog, whose reload
// runs on Jest's synchronous SQLite driver: it can hold the event loop past
// waitFor's 1 s default when the full suite runs in parallel.
const AFTER_WRITE = { timeout: 5000 };

const readings = () => localDatabase().select().from(bodyWeightMeasurements).all();
const storedPreference = () =>
  localDatabase().select().from(userSettings).get()?.bodyweightCalculationsEnabled ?? false;

const seedReading = async (weightValue: string) => {
  let id = '';
  await act(async () => {
    id = (await bodyweightRepository.saveBodyWeightReading({
      weightValue,
      measuredAt: new Date(Date.now() - 60 * 60_000),
    })).id;
  });
  return id;
};

const openScreen = async () => {
  await bootLocalApp();
  render(<BodyWeightScreen />);
  await screen.findByTestId('body-weight-current');
};

const pressAlertButton = (style: AlertButton['style']) => {
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  act(() => buttons?.find((button) => button.style === style)?.onPress?.());
};

describe('body weight log', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetLocalData();
    __resetBodyweightCalculationPreferenceForTests();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    closeLocalData();
  });

  it('starts empty and saves a kg reading offline into the history', async () => {
    await openScreen();
    expect(screen.getByTestId('body-weight-empty')).toBeTruthy();
    expect(screen.getByTestId('body-weight-current')).toHaveProp('accessibilityLabel', 'Current body weight Unknown');

    fireEvent.press(screen.getByTestId('body-weight-add'));
    fireEvent.changeText(screen.getByTestId('weight-entry-value'), '82');
    expect(screen.getByLabelText('Body weight in kilograms')).toBeTruthy();
    expect(screen.queryByTestId('weight-entry-unit-lb')).toBeNull();
    fireEvent.press(screen.getByTestId('weight-entry-save'));

    await waitFor(() => expect(screen.queryByTestId('weight-entry-sheet')).toBeNull(), AFTER_WRITE);
    expect(screen.getByText('Reading saved.')).toBeTruthy();
    const [saved] = readings();
    expect(saved).toMatchObject({ weightKg: 82, deletedAt: null, localDirty: true });
    expect(await screen.findByTestId(`body-weight-reading-${saved.id}`, {}, AFTER_WRITE)).toBeTruthy();
    expect(screen.getByTestId('body-weight-current'))
      .toHaveProp('accessibilityLabel', 'Current body weight · kg 82');
  });

  it('keeps invalid and failed input editable, then retries successfully', async () => {
    await openScreen();
    fireEvent.press(screen.getByTestId('body-weight-add'));
    fireEvent.press(screen.getByTestId('weight-entry-save'));
    expect(screen.getByTestId('weight-entry-value-error')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('weight-entry-value'), '80.25');
    fireEvent.changeText(screen.getByTestId('weight-entry-date'), '2999-01-01 10:00');
    fireEvent.press(screen.getByTestId('weight-entry-save'));
    expect(screen.getByText('The measurement date cannot be in the future.')).toBeTruthy();
    expect(readings()).toEqual([]);

    // A failed write: the editor stays open with what was typed.
    jest.spyOn(bodyweightRepository, 'saveBodyWeightReading').mockRejectedValueOnce(new Error('Storage full'));
    const measuredAt = formatCurrentDateTime(new Date(Date.now() - 60 * 60_000));
    fireEvent.changeText(screen.getByTestId('weight-entry-date'), measuredAt);
    fireEvent.press(screen.getByTestId('weight-entry-save'));
    await screen.findByText('Storage full');
    expect(screen.getByTestId('weight-entry-value').props.value).toBe('80.25');
    expect(readings()).toEqual([]);

    fireEvent.press(screen.getByTestId('weight-entry-save'));
    await waitFor(() => expect(screen.queryByTestId('weight-entry-sheet')).toBeNull(), AFTER_WRITE);
    expect(readings()).toEqual([expect.objectContaining({ weightKg: 80.25 })]);
    expect(formatCurrentDateTime(readings()[0].measuredAt)).toBe(measuredAt);
  });

  it('discards cancelled fields and starts each reopened editor from the stored reading', async () => {
    const id = await seedReading('80');
    await openScreen();

    fireEvent.press(await screen.findByTestId(`body-weight-reading-${id}`));
    fireEvent.changeText(screen.getByTestId('weight-entry-value'), '92');
    fireEvent(screen.getByTestId('weight-entry-sheet'), 'accessibilityEscape');
    expect(screen.queryByTestId('weight-entry-sheet')).toBeNull();

    fireEvent.press(screen.getByTestId(`body-weight-reading-${id}`));
    expect(screen.getByTestId('weight-entry-value').props.value).toBe('80');
    expect(readings()).toEqual([expect.objectContaining({ id, weightKg: 80 })]);
  });

  it('deletes only after a destructive confirmation, keeping the editor open when the delete fails', async () => {
    const id = await seedReading('80');
    await openScreen();
    fireEvent.press(await screen.findByTestId(`body-weight-reading-${id}`));

    fireEvent.press(screen.getByTestId('weight-entry-delete'));
    expect(Alert.alert).toHaveBeenCalledWith('Delete reading?', 'Delete this weight reading?', expect.any(Array));
    expect(readings()[0].deletedAt).toBeNull();

    // A failed delete: the editor stays open on the reading.
    jest.spyOn(bodyweightRepository, 'deleteBodyWeightReading').mockRejectedValueOnce(new Error('Could not delete'));
    pressAlertButton('destructive');
    await screen.findByText('Could not delete');
    expect(screen.getByTestId('weight-entry-value').props.value).toBe('80');
    expect(readings()[0].deletedAt).toBeNull();

    fireEvent.press(screen.getByTestId('weight-entry-delete'));
    pressAlertButton('destructive');
    await waitFor(() => expect(screen.queryByTestId(`body-weight-reading-${id}`)).toBeNull(), AFTER_WRITE);
    expect(screen.getByTestId('body-weight-empty')).toBeTruthy();
    expect(readings()[0].deletedAt).toBeInstanceOf(Date);
  });
});

describe('Settings bodyweight rows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetLocalData();
    __resetBodyweightCalculationPreferenceForTests();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    closeLocalData();
  });

  const toggle = () => screen.getByTestId('settings-bodyweight-calculations-toggle');

  it('keeps the body weight log available while the private preference turns off and on', async () => {
    await bootLocalApp();
    render(<BodyWeightSettingsRow />);
    await waitFor(() => expect(toggle()).toHaveTextContent('Off'));
    expect(screen.getByText('Body weight log')).toBeTruthy();

    fireEvent.press(screen.getByTestId('settings-body-weight-row'));
    expect(mockPush).toHaveBeenCalledWith('/body-weight');

    for (const [label, enabled] of [['On', true], ['Off', false], ['On', true]] as const) {
      fireEvent.press(toggle());
      expect(toggle()).toHaveTextContent(label);
      expect(screen.getByTestId('settings-body-weight-row')).toBeTruthy();
      await waitFor(() => expect(storedPreference()).toBe(enabled), AFTER_WRITE);
    }
  });

  it('reverts an optimistic toggle and shows a retryable error when the write fails', async () => {
    await bootLocalApp();
    render(<BodyWeightSettingsRow />);
    await waitFor(() => expect(toggle()).toHaveTextContent('Off'));

    // A failed preference write.
    jest.spyOn(userSettingsRepository, 'writeBodyweightCalculationsEnabled')
      .mockRejectedValueOnce(new Error('disk unavailable'));
    fireEvent.press(toggle());
    expect(toggle().props.accessibilityState).toEqual({ checked: true });

    await waitFor(() => expect(toggle().props.accessibilityState).toEqual({ checked: false }), AFTER_WRITE);
    expect(screen.getByTestId('settings-bodyweight-calculations-error'))
      .toHaveTextContent('Bodyweight calculations could not be updated. Try again.');
    expect(storedPreference()).toBe(false);
  });
});
