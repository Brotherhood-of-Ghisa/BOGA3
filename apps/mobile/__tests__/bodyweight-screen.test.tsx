/* eslint-disable import/first */

/**
 * The body weight log, its calculation switch and the Settings card over real data: the production
 * screen, weight editor, reading repository and private calculation
 * preference over the migrated in-memory SQLite database
 * (helpers/local-data.ts). Only the native database open and the router are
 * replaced. Three tests force one rejection on the real module with
 * `jest.spyOn` — a failed reading save, a failed delete and a failed
 * preference write — the only states real data cannot produce.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, StyleSheet, type AlertButton } from 'react-native';

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
import { WeightEntrySheet } from '@/components/bodyweight/weight-entry-sheet';
import { __resetBodyweightCalculationPreferenceForTests } from '@/src/bodyweight/calculation-preference';
import * as bodyweightRepository from '@/src/data/bodyweight';
import { bodyWeightMeasurements, userSettings } from '@/src/data/schema';
import * as userSettingsRepository from '@/src/data/user-settings';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import { formatLocalDateTime } from '@/src/utils/local-time';
import { bootLocalApp, closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';
import { waitForGone } from './helpers/wait-for-gone';

// A reading or preference write invalidates the exercise catalog, whose reload
// runs on Jest's synchronous SQLite driver: it can hold the event loop past
// waitFor's default when the full suite runs in parallel.
jest.setTimeout(90000);
const AFTER_WRITE = { timeout: 35000 };

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
  beforeAll(async () => {
    await bootLocalApp();
    closeLocalData();
  });

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

  it('draws its prose in muted body, its heading as a label and the Measured line\'s figures in Plex Mono', async () => {
    await bootLocalApp();
    await seedReading('82.5');
    render(<BodyWeightScreen />);
    const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never);
    const measured = await screen.findByText(/^Measured /);
    expect(flat(measured)).toMatchObject({ fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.base, color: uiRoles.inkMuted });
    expect(flat(within(measured).getAllByText(/^\d[\d:.,-]*$/)[0])).toMatchObject({ fontFamily: uiFonts.figure.family });
    expect(flat(screen.getByText(/latest reading on or before/))).toMatchObject({ fontFamily: uiFonts.body.family, color: uiRoles.inkMuted });
    expect(flat(screen.getByRole('header', { name: 'Weight history' })))
      .toMatchObject({ fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, textTransform: 'uppercase' });
  });

  it('explains an entry in muted body', () => {
    render(<WeightEntrySheet title="Add reading" initial={{ weightValue: '' }} measuredAt={new Date()} explanation="Used from this session on."
      onSave={jest.fn()} onDismiss={jest.fn()} autoFocus={false} />);
    expect(StyleSheet.flatten(screen.getByText('Used from this session on.').props.style))
      .toMatchObject({ fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.base, color: uiRoles.inkMuted });
  });

  it('starts empty and saves a kg reading offline into the history', async () => {
    await openScreen();
    expect(screen.getByTestId('body-weight-empty')).toBeTruthy();
    expect(screen.getByTestId('body-weight-current')).toHaveProp('accessibilityLabel', 'Current body weight Unknown');
    expect(screen.getByRole('header', { name: 'Calculations' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Weight history' })).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('body-weight-add'));
    fireEvent.changeText(screen.getByTestId('weight-entry-value'), '82');
    expect(screen.getByLabelText('Body weight')).toBeTruthy();
    expect(screen.queryByTestId('weight-entry-unit-lb')).toBeNull();
    fireEvent.press(screen.getByTestId('weight-entry-save'));

    await waitForGone(() => screen.queryByTestId('weight-entry-sheet'), AFTER_WRITE);
    expect(screen.getByText('Reading saved.')).toBeTruthy();
    const [saved] = readings();
    expect(saved).toMatchObject({ weightKg: 82, deletedAt: null, localDirty: true });
    expect(await screen.findByTestId(`body-weight-reading-${saved.id}`, {}, AFTER_WRITE)).toBeTruthy();
    expect(screen.getByTestId('body-weight-current'))
      .toHaveProp('accessibilityLabel', 'Current body weight 82');
  });

  it('keeps invalid and failed input editable, then retries successfully', async () => {
    await openScreen();
    fireEvent.press(screen.getByTestId('body-weight-add'));
    fireEvent.press(screen.getByTestId('weight-entry-save'));
    expect(screen.getByTestId('weight-entry-value-error')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('weight-entry-value'), '80.25');
    fireEvent.changeText(screen.getByTestId('weight-entry-date'), '01-01-2999 10:00');
    fireEvent.press(screen.getByTestId('weight-entry-save'));
    expect(screen.getByText('The measurement date cannot be in the future.')).toBeTruthy();
    expect(readings()).toEqual([]);

    // A failed write: the editor stays open with what was typed.
    jest.spyOn(bodyweightRepository, 'saveBodyWeightReading').mockRejectedValueOnce(new Error('Storage full'));
    const measuredAt = formatLocalDateTime(Date.now() - 60 * 60_000, 'DD-MM-YYYY');
    fireEvent.changeText(screen.getByTestId('weight-entry-date'), measuredAt);
    fireEvent.press(screen.getByTestId('weight-entry-save'));
    await screen.findByText('Storage full');
    expect(screen.getByTestId('weight-entry-value').props.value).toBe('80.25');
    expect(readings()).toEqual([]);

    fireEvent.press(screen.getByTestId('weight-entry-save'));
    await waitForGone(() => screen.queryByTestId('weight-entry-sheet'), AFTER_WRITE);
    expect(readings()).toEqual([expect.objectContaining({ weightKg: 80.25 })]);
    expect(formatLocalDateTime(readings()[0].measuredAt.getTime(), 'DD-MM-YYYY')).toBe(measuredAt);
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
    await waitForGone(() => screen.queryByTestId(`body-weight-reading-${id}`), AFTER_WRITE);
    expect(screen.getByTestId('body-weight-empty')).toBeTruthy();
    expect(readings()[0].deletedAt).toBeInstanceOf(Date);
  });
});

describe('bodyweight calculations and the Settings card', () => {
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
  const cardStatus = () => screen.getByTestId('settings-body-weight-row').props.accessibilityLabel;

  it('summarises the switch and the current reading on the card, which opens the body weight page', async () => {
    await bootLocalApp();
    render(<BodyWeightSettingsRow />);
    await waitFor(() => expect(cardStatus()).toBe('Bodyweight, Off'));
    // The switch lives on the page, not the card.
    expect(screen.queryByTestId('settings-bodyweight-calculations-toggle')).toBeNull();

    fireEvent.press(screen.getByTestId('settings-body-weight-row'));
    expect(mockPush).toHaveBeenCalledWith('/body-weight');
    screen.unmount();

    await seedReading('82.5');
    render(<BodyWeightSettingsRow />);
    await waitFor(() => expect(cardStatus()).toBe('Bodyweight, Off · 82.5'));
  });

  it('shows the reading sessions use, skipping a newer reading that needs review', async () => {
    await bootLocalApp();
    // The shared resolver (src/data/bodyweight.ts) owns which reading counts.
    const read = jest.spyOn(bodyweightRepository, 'readCurrentBodyWeight')
      .mockResolvedValue({ weightKg: 77 } as Awaited<ReturnType<typeof bodyweightRepository.readCurrentBodyWeight>>);
    render(<BodyWeightSettingsRow />);
    await waitFor(() => expect(cardStatus()).toBe('Bodyweight, Off · 77'));
    expect(read).toHaveBeenCalled();
  });

  it('keeps the body weight log available while the private preference turns off and on', async () => {
    await bootLocalApp();
    render(<><BodyWeightSettingsRow /><BodyWeightScreen /></>);
    await waitFor(() => expect(toggle().props.accessibilityState).toEqual({ checked: false }));
    // The switch sits at the top of the log, above the current reading.
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('settings-bodyweight-calculations-toggle')).toBeLessThan(tree.indexOf('body-weight-current'));

    // A form card's switch row: one accessible switch named for the setting.
    expect(toggle().props.accessibilityRole).toBe('switch');
    expect(toggle().props.accessibilityLabel).toBe('Bodyweight calculations');
    for (const [label, enabled] of [['On', true], ['Off', false], ['On', true]] as const) {
      fireEvent.press(toggle());
      expect(toggle().props.accessibilityState).toEqual({ checked: enabled });
      expect(cardStatus()).toBe(`Bodyweight, ${label}`);
      expect(screen.getByTestId('body-weight-add')).toBeTruthy();
      await waitFor(() => expect(storedPreference()).toBe(enabled), AFTER_WRITE);
    }
  });

  it('reverts an optimistic toggle and shows a retryable error when the write fails', async () => {
    await bootLocalApp();
    render(<BodyWeightScreen />);
    await waitFor(() => expect(toggle().props.accessibilityState).toEqual({ checked: false }));

    // A failed preference write.
    jest.spyOn(userSettingsRepository, 'writeBodyweightCalculationsEnabled')
      .mockRejectedValueOnce(new Error('disk unavailable'));
    fireEvent.press(toggle());
    expect(toggle().props.accessibilityState).toEqual({ checked: true });

    await waitFor(() => expect(toggle().props.accessibilityState).toEqual({ checked: false }), AFTER_WRITE);
    expect(screen.getByTestId('settings-bodyweight-calculations-error'))
      .toHaveTextContent('Bodyweight calculations could not be updated. Try again.');
    expect(StyleSheet.flatten(screen.getByTestId('settings-bodyweight-calculations-error').props.style))
      .toMatchObject({ fontFamily: uiFonts.body.family, fontSize: uiTypography.size.sm, color: uiRoles.danger });
    expect(storedPreference()).toBe(false);
  });
});
