import { Modal } from 'react-native';
import { BodyWeightScreen } from '@/components/bodyweight/body-weight-screen';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { SessionWeightBackfillSheet } from '@/components/bodyweight/backfill-sheet';
import type { SessionWeightBackfillInventory } from '@/src/data/bodyweight-backfill';

jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => {
  const React = jest.requireActual('react'); React.useEffect(callback, [callback]);
} }));
jest.mock('@/src/data/bodyweight', () => ({
  listBodyWeightReadings: jest.fn().mockResolvedValue([]),
  saveBodyWeightReading: jest.fn().mockResolvedValue(undefined), deleteBodyWeightReading: jest.fn(),
}));
jest.mock('@/src/data/bodyweight-backfill', () => ({
  ...jest.requireActual('@/src/data/bodyweight-backfill'),
  loadSessionWeightBackfill: jest.fn(), applySessionWeightBackfill: jest.fn(),
}));
const data = jest.requireMock('@/src/data/bodyweight-backfill') as Record<string, jest.Mock>;
const inventory: SessionWeightBackfillInventory = {
  hasReadings: true, range: { from: null, before: null }, readingFingerprint: 'readings', sessionFingerprints: { s1: 'session' },
  rows: [{ sessionId: 's1', startedAt: new Date('2026-09-05T12:00:00Z'), status: 'ready', snapshot: {
    bodyWeightKg: 80, bodyWeightSource: 'historical_estimate', bodyWeightMeasurementId: 'r1',
    bodyWeightMeasuredAt: new Date('2026-09-10T12:00:00Z'),
  } }],
};
beforeEach(() => {
  jest.clearAllMocks(); data.loadSessionWeightBackfill.mockResolvedValue(inventory);
  data.applySessionWeightBackfill.mockResolvedValue({ filled: 1, skipped: 0 });
});
const open = async (onDismiss = jest.fn(), onAddReading = jest.fn()) => {
  render(<SessionWeightBackfillSheet visible onDismiss={onDismiss} onAddReading={onAddReading} />);
  await screen.findByTestId('bodyweight-backfill-select-s1');
  return { onDismiss, onAddReading };
};

it('defaults to eligible missing sessions, previews the later source explicitly and writes only on Apply', async () => {
  const { onDismiss } = await open();
  expect(data.applySessionWeightBackfill).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('bodyweight-backfill-preview'));
  expect(screen.getByText('1 session · 1 estimated')).toBeTruthy();
  expect(screen.getByTestId('bodyweight-backfill-preview-s1')).toHaveTextContent(/80 kg · Estimated from 2026-09-10/);
  expect(data.applySessionWeightBackfill).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('bodyweight-backfill-apply'));
  await screen.findByTestId('bodyweight-backfill-result');
  expect(data.applySessionWeightBackfill).toHaveBeenCalledWith(expect.objectContaining({ selectedIds: ['s1'] }));
  fireEvent.press(screen.getByTestId('bodyweight-backfill-done'));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it('cancels without writing and requires applying a changed date range before preview', async () => {
  const { onDismiss } = await open();
  fireEvent.changeText(screen.getByTestId('bodyweight-backfill-from'), '2026-09-01');
  expect(screen.getByTestId('bodyweight-backfill-preview')).toBeDisabled();
  fireEvent.press(screen.getByTestId('bodyweight-backfill-range'));
  await waitFor(() => expect(data.loadSessionWeightBackfill).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByTestId('bodyweight-backfill-preview')).toBeEnabled());
  fireEvent.press(screen.getByTestId('bodyweight-backfill-cancel'));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(data.applySessionWeightBackfill).not.toHaveBeenCalled();
});

it('retains a failed preview and offers refresh without hiding the stale-input error', async () => {
  data.applySessionWeightBackfill.mockRejectedValue(new Error('Weight readings changed. Refresh the preview before applying.'));
  await open(); fireEvent.press(screen.getByTestId('bodyweight-backfill-preview'));
  fireEvent.press(screen.getByTestId('bodyweight-backfill-apply'));
  await screen.findByText('Weight readings changed. Refresh the preview before applying.');
  expect(screen.getByTestId('bodyweight-backfill-preview-s1')).toBeTruthy();
  fireEvent.press(screen.getByTestId('bodyweight-backfill-refresh'));
  await waitFor(() => expect(data.loadSessionWeightBackfill).toHaveBeenCalledTimes(2));
  await screen.findByTestId('bodyweight-backfill-select-s1');
});

it('blocks duplicate apply and dismissal while the transaction is pending', async () => {
  let finish!: (value: { filled: number; skipped: number }) => void;
  data.applySessionWeightBackfill.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { onDismiss } = await open(); fireEvent.press(screen.getByTestId('bodyweight-backfill-preview'));
  fireEvent.press(screen.getByTestId('bodyweight-backfill-apply'));
  fireEvent.press(screen.getByTestId('bodyweight-backfill-apply'));
  fireEvent(screen.getByTestId('bodyweight-backfill'), 'accessibilityEscape');
  expect(onDismiss).not.toHaveBeenCalled(); expect(data.applySessionWeightBackfill).toHaveBeenCalledTimes(1);
  await act(async () => finish({ filled: 1, skipped: 0 }));
  await screen.findByTestId('bodyweight-backfill-result');
});

it('offers reading entry when no source exists and never enables filling', async () => {
  data.loadSessionWeightBackfill.mockResolvedValue({ ...inventory, hasReadings: false,
    rows: [{ sessionId: 's1', startedAt: new Date(), status: 'blocked', reason: 'Add a weight reading.' }] });
  const { onAddReading } = await open();
  expect(screen.getByTestId('bodyweight-backfill-preview')).toBeDisabled();
  fireEvent.press(screen.getByText('Add reading'));
  expect(onAddReading).toHaveBeenCalledTimes(1);
  expect(data.applySessionWeightBackfill).not.toHaveBeenCalled();
});


it('waits for the iOS backfill modal to finish dismissing before presenting and saving a reading', async () => {
  data.loadSessionWeightBackfill.mockResolvedValue({ ...inventory, hasReadings: false, rows: [] });
  render(<BodyWeightScreen />);
  fireEvent.press(await screen.findByTestId('body-weight-backfill'));
  const empty = await screen.findByTestId('bodyweight-backfill-no-readings');
  const modal = screen.UNSAFE_getByType(Modal);
  fireEvent.press(within(empty).getByText('Add reading'));
  expect(screen.queryByTestId('weight-entry-value')).toBeNull();
  fireEvent(modal, 'dismiss');
  fireEvent.changeText(await screen.findByTestId('weight-entry-value'), '81');
  fireEvent.press(screen.getByTestId('weight-entry-save'));
  const save = jest.requireMock('@/src/data/bodyweight').saveBodyWeightReading;
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ weightValue: '81', weightUnit: 'kg' })));
  await waitFor(() => expect(screen.queryByTestId('weight-entry-value')).toBeNull());
  fireEvent(modal, 'dismiss');
  expect(screen.queryByTestId('weight-entry-value')).toBeNull();
});
