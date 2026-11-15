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
  fireEvent.press(screen.getByTestId('today-cow-current-open'));
  expect(screen.getByTestId('ui-gallery-action')).toHaveTextContent('Current CoW');
  fireEvent.press(screen.getByTestId('today-cow-week-earlier'));
  expect(screen.getByTestId('ui-gallery-action')).toHaveTextContent('Last week CoW');
  current.unmount();
  render(<CompactGallery initialSample="embedded" initialState="past" />);
  expect(screen.getByText('Last Week CoW')).toBeTruthy();
  expect(screen.getByTestId('today-cow-week-earlier')).toBeDisabled();
  expect(screen.getByTestId('today-cow-previous-rows')).toBeTruthy();
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

it('selects the ListCard family under the existing development guard', () => {
  mockParams = { family: 'list', sample: 'boards', review: '1' };
  const view = render(<UiGalleryRoute />);
  expect(screen.getByTestId('ui-gallery-list-boards-ready-normal')).toBeTruthy();
  mockDev = false;
  view.rerender(<UiGalleryRoute />);
  expect(screen.queryByTestId('ui-gallery-list-boards-ready-normal')).toBeNull();
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

it('selects the Summary family and can return to the existing gallery samples', () => {
  render(<CompactGallery />);
  fireEvent.press(screen.getByTestId('ui-gallery-sample-summary'));
  expect(screen.getByTestId('group-week-totals-card')).toBeTruthy();
  fireEvent.press(screen.getByTestId('ui-gallery-sample-stream'));
  expect(screen.getByTestId('group-stream-session-card-reference')).toBeTruthy();
});

it.each([true, false])('keeps Summary deep links under the existing gallery guard (development=%s)', dev => {
  mockDev = dev;
  mockParams = { sample: 'summary', state: 'zero', review: '1' };
  render(<UiGalleryRoute />);
  if (dev) expect(screen.getByTestId('group-week-totals-sets-value')).toHaveTextContent('0');
  else expect(screen.queryByTestId('group-week-totals-card')).toBeNull();
});


it('selects production table fixtures through the same development-only route', () => {
  mockParams = { family: 'table', review: '1' };
  const view = render(<UiGalleryRoute />);
  expect(screen.getByTestId('stats-muscle-table')).toBeTruthy();
  mockDev = false;
  view.rerender(<UiGalleryRoute />);
  expect(screen.queryByTestId('stats-muscle-table')).toBeNull();
});


it.each(['compact', 'list', 'table', 'summary'])('keeps the %s family behind release and StoreClient guards', family => {
  mockParams = { family, review: '1' };
  mockDev = false;
  const view = render(<UiGalleryRoute />);
  expect(view.toJSON()).toBeNull();
  mockDev = true;
  const previous = Constants.executionEnvironment;
  Object.defineProperty(Constants, 'executionEnvironment', { configurable: true, value: ExecutionEnvironment.StoreClient });
  try { view.rerender(<UiGalleryRoute />); expect(view.toJSON()).toBeNull(); }
  finally { Object.defineProperty(Constants, 'executionEnvironment', { configurable: true, value: previous }); }
});

it('opens SummaryTile directly by family and retains error/retry presentation', () => {
  mockParams = { family: 'summary', state: 'error', review: '1' };
  render(<UiGalleryRoute />);
  expect(screen.getByTestId('ui-gallery-summary-error-normal')).toBeTruthy();
  fireEvent.press(screen.getByText('Retry'));
  expect(screen.getByTestId('group-week-totals-card')).toBeTruthy();
  expect(screen.getByTestId('ui-gallery-summary-action')).toHaveTextContent('Retry');
});
