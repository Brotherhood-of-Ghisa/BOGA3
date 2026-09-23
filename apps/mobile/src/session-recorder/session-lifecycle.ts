import type { Session } from '@/components/session-recorder/types';
import { completeSessionDraft, persistSessionDraftSnapshot, setSessionDeletedState } from '@/src/data';

import { toPersistCompletedExercises } from './session-model';

/**
 * Ends an active session the way the recorder always has: persist the
 * completed-history graph (confirmed sets only) over the draft, then mark it
 * completed, which stamps `completedAt` and materialises `durationSec`.
 * Shared by the recorder and the session view so both write the tables alike.
 */
export const completeActiveSession = async (input: {
  sessionId: string | undefined;
  gymId: string | null;
  startedAt: Date;
  completedHistorySession: Session;
}): Promise<string> => {
  const persisted = await persistSessionDraftSnapshot({
    sessionId: input.sessionId,
    gymId: input.gymId,
    startedAt: input.startedAt,
    status: 'active',
    exercises: toPersistCompletedExercises(input.completedHistorySession),
  });

  await completeSessionDraft(persisted.sessionId);
  return persisted.sessionId;
};

/**
 * Abandons an active session: the same soft delete the Sessions list's
 * "Delete active session" performs, so it syncs as a tombstone.
 */
export const abandonActiveSession = (sessionId: string): Promise<void> =>
  setSessionDeletedState(sessionId, true);
