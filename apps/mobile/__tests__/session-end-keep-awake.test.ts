import { AppState } from 'react-native';

import { setRepeatingTimerAwake } from '@/src/session-recorder/repeating-timer-native';
import { __resetRestTimerForTests, startRepeatingTimer } from '@/src/session-recorder/rest-timer';
import { abandonActiveSession, completeActiveSession } from '@/src/session-recorder/session-lifecycle';

// The data layer is faked: this pins the lifecycle's timer wiring, not persistence.
jest.mock('@/src/data', () => ({
  completeSessionDraft: jest.fn(async () => undefined),
  persistSessionDraftSnapshot: jest.fn(async () => ({ sessionId: 'session-1' })),
  setSessionDeletedState: jest.fn(async () => undefined),
}));
jest.mock('@/src/backup/database-backups', () => ({ snapshotAfterSessionCompleted: jest.fn() }));

describe('ending a session', () => {
  beforeEach(() => {
    __resetRestTimerForTests();
    jest.useFakeTimers({ now: 0 });
    jest.clearAllMocks();
    AppState.currentState = 'active';
  });

  afterEach(() => {
    __resetRestTimerForTests();
    jest.useRealTimers();
  });

  it.each([
    ['finishing', () => completeActiveSession({
      sessionId: 'session-1',
      gymId: null,
      startedAt: new Date(0),
      completedHistorySession: { dateTime: new Date(0).toISOString(), locationId: null, exercises: [] },
    })],
    ['abandoning', () => abandonActiveSession('session-1')],
  ] as const)('releases the repeating timer keep-awake when %s it', async (_label, end) => {
    startRepeatingTimer('session-1');
    expect(setRepeatingTimerAwake).toHaveBeenLastCalledWith(true);

    await end();

    expect(setRepeatingTimerAwake).toHaveBeenLastCalledWith(false);
  });
});
