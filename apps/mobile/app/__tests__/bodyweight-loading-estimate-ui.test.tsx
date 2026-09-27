import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { invalidateBodyWeightContext } from '@/src/bodyweight/invalidation';
import { LoadingEstimateSheet } from '@/components/bodyweight/loading-estimate-sheet';
import type { ExerciseHistorySessionEntry } from '@/src/data/exercise-history';

jest.mock('@/src/data/exercise-history', () => ({ loadExercisePerformanceHistory: jest.fn() }));
jest.mock('@/src/data/bodyweight', () => ({ readCurrentBodyWeight: jest.fn() }));
const history = jest.requireMock('@/src/data/exercise-history').loadExercisePerformanceHistory as jest.Mock;
const current = jest.requireMock('@/src/data/bodyweight').readCurrentBodyWeight as jest.Mock;
const context = { bodyweightCoefficient: 1, bodyWeightKg: 80, loadInputMode: 'total_load' };
const at = new Date('2026-09-10T12:00:00Z');
const source: ExerciseHistorySessionEntry = {
  sessionId: 'old', sessionExerciseId: 'old-pull', completedAt: at, gymName: null, tagIds: [],
  bodyWeightKg: 80, bodyWeightSource: 'reading', bodyWeightMeasurementId: 'r', bodyWeightMeasuredAt: at,
  loadContext: context, workingSetCount: 1, estimatedOneRepMax: null, totalVolume: 800, topWeightSet: null,
  sets: [{ setId: 's', orderIndex: 0, weightValue: '20', repsValue: '8', weightUnit: 'kg', externalLoadMode: 'added',
    setType: 'rir_1', isWorking: true }],
};
beforeEach(() => {
  jest.clearAllMocks();
  history.mockResolvedValue({ sessions: [source] });
  current.mockResolvedValue({ id: 'current', weightValue: '90', weightUnit: 'kg', weightKg: 90, measuredAt: at });
});
const mount = (dismiss = jest.fn()) => render(<LoadingEstimateSheet visible exerciseId="pull" context={context} onDismiss={dismiss} />);

it('projects added load from the dated source and withholds targets requiring assistance, clearing stale answers after every edit', async () => {
  const frozen = JSON.stringify(source);
  mount();
  await screen.findByTestId('loading-estimate-calculate');
  expect(screen.getByTestId('loading-estimate-bodyweight').props.value).toBe('80');
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  expect(screen.getByLabelText('Added load · kg 20.00')).toBeTruthy();
  fireEvent.press(screen.getByTestId('loading-estimate-current-reading'));
  expect(screen.queryByTestId('loading-estimate-result')).toBeNull();
  expect(screen.getByTestId('loading-estimate-bodyweight').props.value).toBe('90');
  expect(screen.getByText(/Using your reading on/)).toBeTruthy();
  expect(screen.getByText(/Reading from/)).toBeTruthy();
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  expect(screen.getByLabelText('Added load · kg 10.00')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('loading-estimate-bodyweight'), '110');
  expect(screen.queryByText(/Using your reading on/)).toBeNull();
  expect(screen.getByText('Using your entered target weight. Saved performances stay unchanged.')).toBeTruthy();
  expect(screen.queryByTestId('loading-estimate-result')).toBeNull();
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  expect(screen.getByText('No added-weight estimate is available for this rep target and body weight.')).toBeTruthy();
  expect(screen.queryByTestId('loading-estimate-result')).toBeNull();
  fireEvent.changeText(screen.getByTestId('loading-estimate-bodyweight'), '90');
  fireEvent.press(screen.getByTestId('loading-estimate-unit-lb'));
  expect(screen.queryByTestId('loading-estimate-result')).toBeNull();
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  expect(screen.getByLabelText('Added load · lb 22.05')).toBeTruthy();
  expect(JSON.stringify(source)).toBe(frozen);
});

it('retains invalid targets for correction and explains the one-rep capacity convention', async () => {
  mount(); await screen.findByTestId('loading-estimate-calculate');
  fireEvent.changeText(screen.getByTestId('loading-estimate-reps'), '0');
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  expect(screen.getByText('Enter a positive whole number of target reps.')).toBeTruthy();
  expect(screen.getByTestId('loading-estimate-reps').props.value).toBe('0');
  fireEvent.changeText(screen.getByTestId('loading-estimate-reps'), '1');
  fireEvent.changeText(screen.getByTestId('loading-estimate-bodyweight'), '');
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  expect(screen.getByText('Enter a positive target body weight in kg.')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('loading-estimate-bodyweight'), '80');
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  expect(screen.getByText(/capacity directly/)).toBeTruthy();
});

it('lets the lifter choose a different completed source without carrying over the old projection', async () => {
  history.mockResolvedValue({ sessions: [source, { ...source, sessionId: 'second', sessionExerciseId: 'second-pull',
    sets: [{ ...source.sets[0], setId: 'other', weightValue: '10' }] }] });
  mount(); await screen.findByTestId('loading-estimate-calculate');
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  fireEvent.press(screen.getByTestId('loading-estimate-choose-source'));
  fireEvent.press(screen.getByTestId('loading-estimate-source-second-pull:other'));
  expect(screen.queryByTestId('loading-estimate-result')).toBeNull();
  expect(screen.getByTestId('loading-estimate-source-description').props.children).toContain('Added 10 kg × 8');
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  expect(screen.getByLabelText('Added load · kg 10.00')).toBeTruthy();
});

it('retries a failed history read and explains why incomplete history cannot be used', async () => {
  history.mockRejectedValueOnce(new Error('History unavailable')).mockResolvedValueOnce({ sessions: [] });
  mount(); await screen.findByText('History unavailable');
  fireEvent.press(screen.getByText('Try again'));
  await screen.findByTestId('loading-estimate-empty');
  expect(screen.queryByTestId('loading-estimate-calculate')).toBeNull();
  expect(history).toHaveBeenCalledTimes(2);
});

it('reloads on reopening, ignoring a response from the dismissed request', async () => {
  let resolve!: (value: unknown) => void;
  history.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = mount();
  view.rerender(<LoadingEstimateSheet visible={false} exerciseId="pull" context={context} onDismiss={jest.fn()} />);
  await act(async () => resolve({ sessions: [] }));
  view.rerender(<LoadingEstimateSheet visible exerciseId="pull" context={context} onDismiss={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId('loading-estimate-source-description')).toBeTruthy());
  expect(history).toHaveBeenCalledTimes(2);
});


it('requires an explicit choice of the current reading when the target session has no saved weight', async () => {
  render(<LoadingEstimateSheet visible exerciseId="pull" context={{ ...context, bodyWeightKg: null }} onDismiss={jest.fn()} />);
  await screen.findByTestId('loading-estimate-calculate');
  expect(screen.getByTestId('loading-estimate-bodyweight').props.value).toBe('');
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  expect(screen.getByText('Enter a positive target body weight in kg.')).toBeTruthy();
  fireEvent.press(screen.getByTestId('loading-estimate-current-reading'));
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  expect(screen.getByLabelText('Added load · kg 10.00')).toBeTruthy();
});


it('does not offer an invalid restored reading as usable calculator context', async () => {
  current.mockResolvedValue({ id: 'current', weightValue: '90', weightUnit: 'kg', weightKg: 999, measuredAt: at });
  mount(); await screen.findByTestId('loading-estimate-invalid-reading');
  expect(screen.queryByTestId('loading-estimate-current-reading')).toBeNull();
  expect(screen.getByTestId('loading-estimate-bodyweight').props.value).toBe('80');
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  expect(screen.getByLabelText('Added load · kg 20.00')).toBeTruthy();
});


it('labels per-side source amounts separately from their total resistance', async () => {
  history.mockResolvedValue({ sessions: [{ ...source, loadContext: { ...context, loadInputMode: 'per_side_load' } }] });
  render(<LoadingEstimateSheet visible exerciseId="pull" context={{ ...context, loadInputMode: 'per_side_load' }} onDismiss={jest.fn()} />);
  await screen.findByTestId('loading-estimate-source-description');
  expect(screen.getByTestId('loading-estimate-source-description').props.children).toContain('Added 20 kg/side × 8');
  expect(screen.getByText(/120.0 kg effective load/)).toBeTruthy();
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  expect(screen.getByLabelText('Added load per side · kg 20.00')).toBeTruthy();
});


it('refreshes a changed source while preserving selected performance and entered targets', async () => {
  const other = { ...source, sessionId: 'second', sessionExerciseId: 'second-pull',
    sets: [{ ...source.sets[0], setId: 'other', weightValue: '10' }] };
  history.mockResolvedValue({ sessions: [source, other] });
  mount(); await screen.findByTestId('loading-estimate-calculate');
  fireEvent.press(screen.getByTestId('loading-estimate-choose-source'));
  fireEvent.press(screen.getByTestId('loading-estimate-source-second-pull:other'));
  fireEvent.changeText(screen.getByTestId('loading-estimate-reps'), '6');
  fireEvent.changeText(screen.getByTestId('loading-estimate-bodyweight'), '85');
  fireEvent.press(screen.getByTestId('loading-estimate-unit-lb'));
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  expect(screen.getByTestId('loading-estimate-result')).toBeTruthy();
  history.mockResolvedValue({ sessions: [source, { ...other, bodyWeightKg: 82, loadContext: { ...context, bodyWeightKg: 82 } }] });
  await act(async () => { invalidateBodyWeightContext(); });
  expect(screen.getByTestId('loading-estimate-source-description').props.children).toContain('Added 10 kg');
  expect(screen.getByTestId('loading-estimate-reps').props.value).toBe('6');
  expect(screen.getByTestId('loading-estimate-bodyweight').props.value).toBe('85');
  expect(screen.queryByTestId('loading-estimate-result')).toBeNull();
  fireEvent.press(screen.getByTestId('loading-estimate-calculate'));
  expect(screen.getByLabelText(/Added load · lb/)).toBeTruthy();
  expect(screen.getByText(/dated session weight 82 kg/)).toBeTruthy();
});
