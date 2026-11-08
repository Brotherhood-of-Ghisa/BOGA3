import { render, waitFor } from '@testing-library/react-native';

import MaestroHarnessScreen from '@/app/maestro-harness';
import * as harness from '@/src/maestro/harness';
import { suppressNotificationPrompt } from '@/src/session-recorder/notification-prompt-suppression';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ reset: 'data' }),
  useRouter: () => ({ replace: jest.fn() }),
}));
jest.mock('@/src/session-recorder/notification-prompt-suppression', () => ({
  suppressNotificationPrompt: jest.fn(),
}));
jest.mock('@/src/exercise-catalog/stats-cache', () => ({
  prepareExerciseHistoryReadForMaestro: jest.fn(async () => undefined),
}));
jest.mock('@/src/maestro/harness', () => {
  const actual = jest.requireActual('@/src/maestro/harness');
  return {
    ...actual,
    isMaestroHarnessAllowed: jest.fn(() => true),
    runMaestroHarnessReset: jest.fn(async () => undefined),
    runMaestroHarnessFixture: jest.fn(async () => undefined),
    runMaestroHarnessBodyweightPreference: jest.fn(),
    runMaestroHarnessBootstrapAction: jest.fn(async () => undefined),
    runMaestroHarnessGateAction: jest.fn(),
  };
});

describe('maestro-harness route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(harness.isMaestroHarnessAllowed).mockReturnValue(true);
  });

  it('suppresses the notification prompt before running the reset', async () => {
    const order: string[] = [];
    jest.mocked(suppressNotificationPrompt).mockImplementation(() => {
      order.push('suppress');
    });
    jest.mocked(harness.runMaestroHarnessReset).mockImplementation(async () => {
      order.push('reset');
    });

    const screen = render(<MaestroHarnessScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('maestro-harness-status').props.children).toBe('Maestro data reset complete.');
    });
    expect(order).toEqual(['suppress', 'reset']);
  });

  it('leaves the prompt alone when the harness is not allowed', async () => {
    jest.mocked(harness.isMaestroHarnessAllowed).mockReturnValue(false);

    const screen = render(<MaestroHarnessScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('maestro-harness-status').props.children).toMatch(/only available/);
    });
    expect(suppressNotificationPrompt).not.toHaveBeenCalled();
    expect(harness.runMaestroHarnessReset).not.toHaveBeenCalled();
  });
});
