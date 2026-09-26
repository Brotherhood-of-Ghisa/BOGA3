import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { BodyWeightScreen } from '@/components/bodyweight/body-weight-screen';
import { SessionBodyWeight } from '@/components/bodyweight/session-body-weight';
import { BodyWeightSettingsRow } from '@/components/bodyweight/settings-row';
import { WeightEntrySheet } from '@/components/bodyweight/weight-entry-sheet';
import { formatCurrentDateTime } from '@/src/session-recorder/session-model';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: (callback: () => void) => {
  const React = jest.requireActual('react'); React.useEffect(callback, [callback]);
} }));
jest.mock('@/src/data/bodyweight', () => ({
  readCurrentBodyWeight: jest.fn(), listBodyWeightReadings: jest.fn(), saveBodyWeightReading: jest.fn(), deleteBodyWeightReading: jest.fn(),
  correctSessionBodyWeight: jest.fn(),
}));
const data = jest.requireMock('@/src/data/bodyweight') as Record<string, jest.Mock>;
const reading = { id: 'r1', weightValue: '80', weightUnit: 'kg', weightKg: 80,
  measuredAt: new Date('2026-01-01T10:23:45.678Z') };
beforeEach(() => {
  jest.clearAllMocks();
  data.listBodyWeightReadings.mockResolvedValue([]);
  data.saveBodyWeightReading.mockResolvedValue(reading);
});

it('shows empty history and saves an explicit lb reading with its date offline', async () => {
  render(<BodyWeightScreen />);
  await screen.findByTestId('body-weight-empty');
  fireEvent.press(screen.getByTestId('body-weight-add'));
  fireEvent.changeText(screen.getByTestId('weight-entry-value'), '176.4');
  fireEvent.press(screen.getByTestId('weight-entry-unit-lb'));
  fireEvent.press(screen.getByTestId('weight-entry-save'));
  await waitFor(() => expect(data.saveBodyWeightReading).toHaveBeenCalledWith(expect.objectContaining({
    weightValue: '176.4', weightUnit: 'lb', measuredAt: expect.any(Date),
  })));
  await waitFor(() => expect(screen.queryByTestId('weight-entry-sheet')).toBeNull());
  expect(screen.getByText('Reading saved. Existing sessions are unchanged.')).toBeTruthy();
});

it('keeps invalid and failed input editable, then retries successfully', async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error('Storage full')).mockResolvedValue(undefined);
  const dismiss = jest.fn();
  render(<WeightEntrySheet title="Add reading" initial={{ weightValue: '', weightUnit: 'kg' }}
    measuredAt={reading.measuredAt} explanation="Saved sessions stay fixed." onSave={save} onDismiss={dismiss} />);
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
  fireEvent.press(screen.getByTestId('weight-entry-unit-lb'));
  fireEvent(screen.getByTestId('weight-entry-sheet'), 'accessibilityEscape');
  expect(screen.queryByTestId('weight-entry-sheet')).toBeNull();
  fireEvent.press(screen.getByTestId('body-weight-reading-r1'));
  expect(screen.getByTestId('weight-entry-value').props.value).toBe('80');
  expect(screen.getByLabelText('Body weight in kg')).toBeTruthy();
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
  expect(alert).toHaveBeenCalledWith('Delete reading?', expect.stringContaining('Saved session weights stay unchanged'), expect.any(Array));
  const confirm = alert.mock.calls[0][2]?.find(button => button.style === 'destructive');
  act(() => confirm?.onPress?.());
  await screen.findByText('Could not delete');
  expect(screen.getByTestId('weight-entry-value').props.value).toBe('80');
  alert.mockRestore();
});

it('shows source context and changes only a session with an explicit manual override', async () => {
  const onSaved = jest.fn();
  const updated = { bodyWeightKg: 82, bodyWeightSource: 'manual', bodyWeightMeasurementId: null, bodyWeightMeasuredAt: null };
  data.correctSessionBodyWeight.mockResolvedValue(updated);
  render(<SessionBodyWeight sessionId="s1" snapshot={{ bodyWeightKg: 80, bodyWeightSource: 'historical_estimate',
    bodyWeightMeasurementId: 'r1', bodyWeightMeasuredAt: reading.measuredAt }} onSaved={onSaved} />);
  expect(screen.getByText(`Estimated from ${formatCurrentDateTime(reading.measuredAt)}`)).toBeTruthy();
  fireEvent.press(screen.getByTestId('session-body-weight'));
  expect(screen.queryByTestId('weight-entry-date')).toBeNull();
  expect(screen.getByText(/certifications may need review/)).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('weight-entry-value'), '82');
  fireEvent.press(screen.getByTestId('weight-entry-save'));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
  expect(data.correctSessionBodyWeight).toHaveBeenCalledWith('s1', expect.objectContaining({ weightValue: '82', weightUnit: 'kg' }));
  expect(data.saveBodyWeightReading).not.toHaveBeenCalled();
});

it('shows the current reading on Settings and navigates to its history', async () => {
  data.readCurrentBodyWeight.mockResolvedValue(reading);
  render(<BodyWeightSettingsRow />);
  await screen.findByText(`80 kg · ${formatCurrentDateTime(reading.measuredAt)}`);
  fireEvent.press(screen.getByTestId('settings-body-weight-row'));
  expect(mockPush).toHaveBeenCalledWith('/body-weight');
});
