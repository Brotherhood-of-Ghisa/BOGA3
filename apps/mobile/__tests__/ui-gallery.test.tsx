import { fireEvent, render, screen } from '@testing-library/react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { CompactGallery } from '@/components/pattern-gallery/compact-gallery';
import UiGalleryRoute from '@/app/ui-gallery';
import { isUiGalleryAllowed } from '@/src/utils/isUiGalleryAllowed';

let mockDev = true;
let mockParams: Record<string, string> = {};
jest.mock('@/src/utils/isDevMode', () => ({ isDevMode: () => mockDev }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn() }),
}));

beforeEach(() => { mockDev = true; mockParams = {}; });

it('renders the actual Stream presenters and reports their existing callbacks', () => {
  render(<CompactGallery />);
  fireEvent.press(screen.getByTestId('group-stream-session-card-reference'));
  expect(screen.getByTestId('ui-gallery-action')).toHaveTextContent('Session');
  fireEvent.press(screen.getByTestId('group-stream-session-card-reference-record-record'));
  expect(screen.getByTestId('ui-gallery-action')).toHaveTextContent('Record · record');
  fireEvent.press(screen.getByTestId('group-metric-stream-event1'));
  expect(screen.getByTestId('ui-gallery-action')).toHaveTextContent('Board history');
  fireEvent.press(screen.getByTestId('ui-gallery-long'));
  expect(screen.getByTestId('group-stream-session-card-reference-member')).toHaveTextContent('Contessa Serbelloni Mazzanti Vien dal Mare');
  expect(screen.getByTestId('group-stream-session-card-reference-metrics')).toHaveTextContent(/123456 sets/);
  fireEvent.press(screen.getByTestId('ui-gallery-long'));
  expect(screen.getByTestId('group-stream-session-card-reference-member')).toHaveTextContent('Alex');
  expect(screen.getByTestId('group-stream-session-card-reference-record-record')).toHaveTextContent(/Bench press/);
  fireEvent.press(screen.getByTestId('ui-gallery-sample-cow'));
  expect(screen.getByText('Pull-up')).toHaveTextContent('Pull-up');
});

it('renders embedded current/past semantics without replacing production read hooks', () => {
  const current = render(<CompactGallery initialSample="embedded" />);
  fireEvent.press(screen.getByTestId('today-cow-current'));
  expect(screen.getByTestId('ui-gallery-action')).toHaveTextContent('Current CoW');
  current.unmount();
  render(<CompactGallery initialSample="embedded" initialState="past" />);
  expect(screen.getByTestId('today-cow-previous').props.onPress).toBeUndefined();
  expect(screen.getByTestId('today-cow-winner-e1rm')).toBeTruthy();
});

it('recovers a failed embedded read through the real retry presenter', () => {
  render(<CompactGallery initialSample="embedded" initialState="error" />);
  expect(screen.getByTestId('today-cow-current-error-state')).toBeTruthy();
  fireEvent.press(screen.getByTestId('today-cow-current-error-state-retry'));
  expect(screen.getByTestId('today-cow-current-exercise')).toHaveTextContent('Pull-up');
  expect(screen.queryByTestId('today-cow-current-error-state')).toBeNull();
  expect(screen.getByTestId('ui-gallery-action')).toHaveTextContent('Retry');
});

it.each(['loading', 'absent', 'offline', 'pending', 'unavailable', 'empty'])('provides the embedded %s fixture', state => {
  render(<CompactGallery initialSample="embedded" initialState={state} />);
  expect(screen.getByTestId(`ui-gallery-embedded-${state}-normal`)).toBeTruthy();
  if (state === 'loading') expect(screen.getByTestId('today-cow-current-loading')).toBeTruthy();
  if (state === 'absent') expect(screen.queryByTestId('today-cow-current')).toBeNull();
});

it('switches CoW metrics, opens the selected metric and cycles states', () => {
  render(<CompactGallery initialSample="cow" />);
  fireEvent.press(screen.getByTestId('gallery-cow-metric-volume'));
  fireEvent.press(screen.getByTestId('gallery-cow-open'));
  expect(screen.getByTestId('ui-gallery-action')).toHaveTextContent('CoW · volume');
  fireEvent.press(screen.getByTestId('gallery-cow-browse'));
  expect(screen.getByTestId('ui-gallery-action')).toHaveTextContent('Standings · volume');
  fireEvent.press(screen.getByTestId('ui-gallery-state'));
  expect(screen.getByTestId('ui-gallery-cow-past-normal')).toBeTruthy();
  fireEvent.press(screen.getByTestId('ui-gallery-sample-embedded'));
  expect(screen.getByTestId('ui-gallery-embedded-past-normal')).toBeTruthy();
});

it('normalizes unknown deep-link values and can hide only gallery controls for review captures', () => {
  mockParams = { sample: 'unknown', state: 'unknown', review: '1' };
  render(<UiGalleryRoute />);
  expect(screen.getByTestId('ui-gallery-stream-ready-normal')).toBeTruthy();
  expect(screen.queryByTestId('ui-gallery-sample-row')).toBeNull();
});

it('never mounts gallery fixtures in a release build', () => {
  mockDev = false;
  render(<UiGalleryRoute />);
  expect(screen.queryByTestId('ui-gallery-stream-ready-normal')).toBeNull();
});

it('rejects StoreClient even in development', () => {
  const old = Constants.executionEnvironment;
  Object.defineProperty(Constants, 'executionEnvironment', { configurable: true, value: ExecutionEnvironment.StoreClient });
  try { expect(isUiGalleryAllowed()).toBe(false); }
  finally { Object.defineProperty(Constants, 'executionEnvironment', { configurable: true, value: old }); }
});


it('offers only states the CoW presenter can render and restores ready after the last state', () => {
  render(<CompactGallery initialSample="cow" initialState="loading" />);
  expect(screen.getByTestId('ui-gallery-cow-ready-normal')).toBeTruthy();
  for (const state of ['past', 'pending', 'unavailable', 'empty', 'ready']) {
    fireEvent.press(screen.getByTestId('ui-gallery-state'));
    expect(screen.getByTestId(`ui-gallery-cow-${state}-normal`)).toBeTruthy();
    if (state === 'pending' || state === 'unavailable') {
      expect(screen.getByTestId('gallery-cow-state')).toHaveTextContent(state === 'pending' ? 'Updating' : 'Group comparisons unavailable');
    }
    if (state === 'empty') expect(screen.getByTestId('gallery-cow-rows')).toHaveTextContent(/No qualifying results/);
  }
});

it('normalizes Stream state links to its actual ready presentation', () => {
  render(<CompactGallery initialState="error" />);
  expect(screen.getByTestId('ui-gallery-stream-ready-normal')).toBeTruthy();
});
