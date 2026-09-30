/* eslint-disable import/first */
const mockReadPreference = jest.fn();
const mockWritePreference = jest.fn();
const mockPush = jest.fn();

jest.mock('@/src/data/user-settings', () => ({
  readBodyweightCalculationsEnabled: (...args: unknown[]) => mockReadPreference(...args),
  writeBodyweightCalculationsEnabled: (...args: unknown[]) => mockWritePreference(...args),
}));
jest.mock('@/src/exercise-catalog/invalidation', () => ({ invalidateExerciseCatalogCache: jest.fn() }));
jest.mock('@/src/bodyweight/invalidation', () => ({ invalidateBodyWeightContext: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BodyWeightSettingsRow } from '@/components/bodyweight/settings-row';
import { __resetBodyweightCalculationPreferenceForTests } from '@/src/bodyweight/calculation-preference';

beforeEach(() => {
  jest.clearAllMocks();
  __resetBodyweightCalculationPreferenceForTests();
  mockReadPreference.mockResolvedValue(false);
});

it('reverts an optimistic toggle and shows an alert when persistence fails', async () => {
  mockWritePreference.mockRejectedValue(new Error('disk unavailable'));
  render(<BodyWeightSettingsRow />);
  await waitFor(() => expect(mockReadPreference).toHaveBeenCalledTimes(1));

  fireEvent.press(screen.getByTestId('settings-bodyweight-calculations-toggle'));
  expect(screen.getByTestId('settings-bodyweight-calculations-toggle').props.accessibilityState)
    .toEqual({ checked: true });

  await waitFor(() => expect(screen.getByTestId('settings-bodyweight-calculations-toggle').props.accessibilityState)
    .toEqual({ checked: false }));
  expect(screen.getByTestId('settings-bodyweight-calculations-error'))
    .toHaveTextContent('Bodyweight calculations could not be updated. Try again.');
});
