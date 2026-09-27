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
}));
jest.mock('@/src/data/session-drafts', () => ({ loadSessionSnapshotById: jest.fn() }));
const mockSession = jest.requireMock('@/src/data/session-drafts').loadSessionSnapshotById as jest.Mock;
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
  expect(alert).toHaveBeenCalledWith('Delete reading?', 'Delete this weight reading?', expect.any(Array));
  const confirm = alert.mock.calls[0][2]?.find(button => button.style === 'destructive');
  act(() => confirm?.onPress?.());
  await screen.findByText('Could not delete');
  expect(screen.getByTestId('weight-entry-value').props.value).toBe('80');
  alert.mockRestore();
});

it('shows derived source context read-only, with no session correction action', () => {
  render(<SessionBodyWeight sessionId="s1" snapshot={{ bodyWeightKg: 80, bodyWeightSource: 'reading',
    bodyWeightMeasurementId: 'r1', bodyWeightMeasuredAt: reading.measuredAt }} onSaved={jest.fn()} />);
  expect(screen.getByText(`Reading from ${formatCurrentDateTime(reading.measuredAt)}`)).toBeTruthy();
  fireEvent.press(screen.getByTestId('session-body-weight'));
  expect(screen.queryByTestId('weight-entry-sheet')).toBeNull();
  expect(screen.queryByTestId('session-body-weight-add-reading')).toBeNull();
});

it('adds a dated reading at the session start, keeps the date editable and refreshes context', async () => {
  const onSaved = jest.fn();
  const updated = { bodyWeightKg: 82, bodyWeightSource: 'reading', bodyWeightMeasurementId: 'r1', bodyWeightMeasuredAt: reading.measuredAt };
  mockSession.mockResolvedValueOnce({ startedAt: reading.measuredAt, deletedAt: null }).mockResolvedValueOnce(updated);
  render(<SessionBodyWeight sessionId="s1" snapshot={{}} onSaved={onSaved} />);
  expect(screen.getByText('No reading on or before this session')).toBeTruthy();
  fireEvent.press(screen.getByTestId('session-body-weight-add-reading'));
  await screen.findByTestId('weight-entry-date');
  expect(screen.getByTestId('weight-entry-date').props.value).toBe(formatCurrentDateTime(reading.measuredAt));
  fireEvent.changeText(screen.getByTestId('weight-entry-value'), '82');
  fireEvent.press(screen.getByTestId('weight-entry-save'));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
  expect(data.saveBodyWeightReading).toHaveBeenCalledWith({ weightValue: '82', weightUnit: 'kg', measuredAt: reading.measuredAt });
});

it('keeps a friend session read-only even without an applicable reading', () => {
  render(<SessionBodyWeight sessionId="friend" snapshot={{}} editable={false} onSaved={jest.fn()} />);
  expect(screen.queryByTestId('session-body-weight-add-reading')).toBeNull();
});

it('shows the current reading on Settings and navigates to its history', async () => {
  data.readCurrentBodyWeight.mockResolvedValue(reading);
  render(<BodyWeightSettingsRow />);
  await screen.findByText(`80 kg · ${formatCurrentDateTime(reading.measuredAt)}`);
  fireEvent.press(screen.getByTestId('settings-body-weight-row'));
  expect(mockPush).toHaveBeenCalledWith('/body-weight');
});
