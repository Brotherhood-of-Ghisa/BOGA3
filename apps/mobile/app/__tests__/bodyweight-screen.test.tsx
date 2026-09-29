import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { BodyWeightScreen } from '@/components/bodyweight/body-weight-screen';
import { BodyWeightSettingsRow } from '@/components/bodyweight/settings-row';
import { WeightEntrySheet } from '@/components/bodyweight/weight-entry-sheet';
import { formatCurrentDateTime } from '@/src/session-recorder/session-model';
import { __resetBodyweightCalculationPreferenceForTests } from '@/src/bodyweight/calculation-preference';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: (callback: () => void) => {
  const React = jest.requireActual('react'); React.useEffect(callback, [callback]);
} }));
jest.mock('@/src/data/bodyweight', () => ({
  readCurrentBodyWeight: jest.fn(), listBodyWeightReadings: jest.fn(), saveBodyWeightReading: jest.fn(), deleteBodyWeightReading: jest.fn(),
}));
const data = jest.requireMock('@/src/data/bodyweight') as Record<string, jest.Mock>;
const reading = { id: 'r1', weightValue: '80', weightUnit: 'kg', weightKg: 80,
  measuredAt: new Date('2026-01-01T10:23:45.678Z') };
beforeEach(() => {
  jest.clearAllMocks();
  __resetBodyweightCalculationPreferenceForTests();
  data.listBodyWeightReadings.mockResolvedValue([]);
  data.saveBodyWeightReading.mockResolvedValue(reading);
});

it('shows empty history and saves a kg reading with its date offline', async () => {
  render(<BodyWeightScreen />);
  await screen.findByTestId('body-weight-empty');
  fireEvent.press(screen.getByTestId('body-weight-add'));
  fireEvent.changeText(screen.getByTestId('weight-entry-value'), '176.4');
  expect(screen.queryByTestId('weight-entry-unit-lb')).toBeNull();
  fireEvent.press(screen.getByTestId('weight-entry-save'));
  await waitFor(() => expect(data.saveBodyWeightReading).toHaveBeenCalledWith(expect.objectContaining({
    weightValue: '176.4', weightUnit: 'kg', measuredAt: expect.any(Date),
  })));
  await waitFor(() => expect(screen.queryByTestId('weight-entry-sheet')).toBeNull());
  expect(screen.getByText('Reading saved.')).toBeTruthy();
});

it('keeps invalid and failed input editable, then retries successfully', async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error('Storage full')).mockResolvedValue(undefined);
  const dismiss = jest.fn();
  render(<WeightEntrySheet title="Add reading" initial={{ weightValue: '', weightUnit: 'kg' }}
    measuredAt={reading.measuredAt} onSave={save} onDismiss={dismiss} />);
  fireEvent.press(screen.getByTestId('weight-entry-save'));
  expect(screen.getByTestId('weight-entry-value-error')).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByTestId('weight-entry-value'), '80.25');
  fireEvent.changeText(screen.getByTestId('weight-entry-date'), '2999-01-01 10:00');
  fireEvent.press(screen.getByTestId('weight-entry-save'));
  expect(screen.getByText('The measurement date cannot be in the future.')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('weight-entry-date'), formatCurrentDateTime(reading.measuredAt));
  fireEvent.press(screen.getByTestId('weight-entry-save'));
  await screen.findByText('Storage full');
  expect(screen.getByTestId('weight-entry-value').props.value).toBe('80.25');
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('weight-entry-save'));
  await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenLastCalledWith({ weightValue: '80.25', weightUnit: 'kg', measuredAt: reading.measuredAt });
});

it('discards cancelled fields and starts each reopened editor from its reading', async () => {
  data.listBodyWeightReadings.mockResolvedValue([reading]);
  render(<BodyWeightScreen />);
  fireEvent.press(await screen.findByTestId('body-weight-reading-r1'));
  fireEvent.changeText(screen.getByTestId('weight-entry-value'), '92');
  fireEvent(screen.getByTestId('weight-entry-sheet'), 'accessibilityEscape');
  expect(screen.queryByTestId('weight-entry-sheet')).toBeNull();
  fireEvent.press(screen.getByTestId('body-weight-reading-r1'));
  expect(screen.getByTestId('weight-entry-value').props.value).toBe('80');
  expect(screen.getByLabelText('Body weight in kilograms')).toBeTruthy();
  expect(data.saveBodyWeightReading).not.toHaveBeenCalled();
});

it('requires a clear delete confirmation and keeps a failed delete editor open', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  data.listBodyWeightReadings.mockResolvedValue([reading]);
  data.deleteBodyWeightReading.mockRejectedValue(new Error('Could not delete'));
  render(<BodyWeightScreen />);
  fireEvent.press(await screen.findByTestId('body-weight-reading-r1'));
  fireEvent.press(screen.getByTestId('weight-entry-delete'));
  expect(data.deleteBodyWeightReading).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('Delete reading?', 'Delete this weight reading?', expect.any(Array));
  const confirm = alert.mock.calls[0][2]?.find(button => button.style === 'destructive');
  act(() => confirm?.onPress?.());
  await screen.findByText('Could not delete');
  expect(screen.getByTestId('weight-entry-value').props.value).toBe('80');
  alert.mockRestore();
});

it('keeps body weight logging available independently from the calculations preference', () => {
  render(<BodyWeightSettingsRow />);

  expect(screen.getByTestId('settings-bodyweight-calculations-toggle')).toHaveTextContent('Off');
  expect(screen.getByTestId('settings-body-weight-row')).toBeTruthy();
  expect(screen.getByText('Body weight log')).toBeTruthy();
  expect(screen.queryByText('Dated readings in kg')).toBeNull();

  fireEvent.press(screen.getByTestId('settings-body-weight-row'));
  expect(mockPush).toHaveBeenCalledWith('/body-weight');

  fireEvent.press(screen.getByTestId('settings-bodyweight-calculations-toggle'));
  expect(screen.getByTestId('settings-bodyweight-calculations-toggle')).toHaveTextContent('On');
  expect(screen.getByTestId('settings-body-weight-row')).toBeTruthy();

  fireEvent.press(screen.getByTestId('settings-bodyweight-calculations-toggle'));
  expect(screen.getByTestId('settings-bodyweight-calculations-toggle')).toHaveTextContent('Off');
  expect(screen.getByTestId('settings-body-weight-row')).toBeTruthy();
});
