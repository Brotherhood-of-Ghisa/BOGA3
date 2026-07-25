import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { SessionsScreen } from '../sessions';
import type { SessionListDataClient, SessionListItem } from '@/components/session-list';

const mockDismissTo = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({
    dismissTo: mockDismissTo,
    push: mockPush,
  }),
}));

const activeSession: SessionListItem = {
  id: 'active-session-1',
  startedAt: '2026-07-25T09:00:00.000Z',
  status: 'active',
  completedAt: null,
  durationSec: null,
  durationDisplay: '5m',
  gymName: null,
  exerciseCount: 1,
  setCount: 3,
  totalWeight: 0,
  deletedAt: null,
};

const buildDataClient = (): jest.Mocked<SessionListDataClient> => ({
  loadSessions: jest.fn().mockResolvedValue([activeSession]),
  startSession: jest.fn().mockResolvedValue(undefined),
  completeActiveSession: jest.fn().mockResolvedValue(undefined),
  discardActiveSession: jest.fn().mockResolvedValue(undefined),
  setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
  appendCompletedSessionAsPlanned: jest.fn().mockResolvedValue(undefined),
});

describe('SessionsScreen active-session navigation', () => {
  beforeEach(() => {
    mockDismissTo.mockClear();
    mockPush.mockClear();
  });

  it('dismisses back to the existing recorder when resuming an active session', async () => {
    const dataClient = buildDataClient();
    render(<SessionsScreen dataClient={dataClient} />);

    fireEvent.press(await screen.findByTestId('resume-active-session-button'));

    expect(mockDismissTo).toHaveBeenCalledWith('/session-recorder');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('routes completion through the recorder cleanup flow instead of completing directly', async () => {
    const dataClient = buildDataClient();
    render(<SessionsScreen dataClient={dataClient} />);

    fireEvent.press(await screen.findByLabelText('Review and complete active session'));

    expect(mockDismissTo).toHaveBeenCalledWith('/session-recorder');
    expect(dataClient.completeActiveSession).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(dataClient.loadSessions).toHaveBeenCalledTimes(1);
    });
  });
});
