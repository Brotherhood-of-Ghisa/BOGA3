/**
 * Data & sync's Apple Health switch (`components/settings/apple-health-section.tsx`):
 * shown on iPhone while signed in, it reflects the person's choice only, turns
 * the import on and off, and shows an import failure with Retry.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AppleHealthSection } from '@/components/settings/apple-health-section';
import type { HealthImportSnapshot } from '@/src/health-import';

const mockState: { snapshot: HealthImportSnapshot } = {
  snapshot: { supported: true, signedIn: true, enabled: false, busy: false, enabling: false, error: null },
};
const mockEnable = jest.fn(async () => undefined);
const mockDisable = jest.fn();
const mockImportNow = jest.fn(async () => undefined);
jest.mock('@/src/health-import', () => ({
  useHealthImport: () => mockState.snapshot,
  enableHealthImport: () => mockEnable(),
  disableHealthImport: () => mockDisable(),
  importHealthActivitiesNow: () => mockImportNow(),
}));

const show = (snapshot: Partial<HealthImportSnapshot>) => {
  mockState.snapshot = { supported: true, signedIn: true, enabled: false, busy: false, enabling: false, error: null, ...snapshot };
  return render(<AppleHealthSection />);
};

beforeEach(() => jest.clearAllMocks());

it('turns the import on and off with one switch', () => {
  show({ enabled: false });
  fireEvent.press(screen.getByTestId('settings-apple-health'));
  expect(mockEnable).toHaveBeenCalledTimes(1);

  show({ enabled: true });
  expect(screen.getByTestId('settings-apple-health')).toHaveProp('accessibilityState', { checked: true });
  fireEvent.press(screen.getByTestId('settings-apple-health'));
  expect(mockDisable).toHaveBeenCalledTimes(1);
});

it.each([
  ['off iPhone', { supported: false }],
  ['signed out', { signedIn: false }],
])('is hidden %s', (_case, snapshot) => {
  show(snapshot);
  expect(screen.queryByTestId('settings-health')).toBeNull();
});

it('shows an import failure with Retry, which imports again', () => {
  show({ enabled: true, error: 'Workouts could not be sent.' });
  expect(screen.getByText('Workouts could not be sent.')).toBeTruthy();
  fireEvent.press(screen.getByText('Retry'));
  expect(mockImportNow).toHaveBeenCalledTimes(1);
});

it('retries turning on when the permission sheet failed, since nothing is enabled to import', () => {
  show({ enabled: false, error: 'Apple Health could not be opened.' });
  fireEvent.press(screen.getByText('Retry'));
  expect(mockEnable).toHaveBeenCalledTimes(1);
  expect(mockImportNow).not.toHaveBeenCalled();
});

it('holds the switch while the permission sheet is open', () => {
  show({ enabling: true });
  expect(screen.getByTestId('settings-apple-health')).toHaveProp('accessibilityState', { checked: false, disabled: true });
  fireEvent.press(screen.getByTestId('settings-apple-health'));
  expect(mockEnable).not.toHaveBeenCalled();
});

it('shows no failure notice without an error', () => {
  show({ enabled: true });
  expect(screen.queryByTestId('settings-apple-health-error')).toBeNull();
});
