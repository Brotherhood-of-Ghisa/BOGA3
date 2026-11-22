import { findActiveSessionId, persistSessionDraftSnapshot, reopenCompletedSessionDraft } from '@/src/data';

import { getAccountLocalPreferenceAccountRevision } from '@/src/preferences/account-local';
import { enterSessionFromExercise, type ExerciseEntryInput, type ExerciseEntryResult } from './exercise-entry';

export type SessionEntryResult = {
  kind: 'resumed' | 'started';
  sessionId: string;
};

export type PlannedSessionMaterializer = () => Promise<{ sessionId: string }>;

export type SessionEntryCoordinator = {
  startFromExercise: (input: ExerciseEntryInput) => Promise<ExerciseEntryResult>;
  resumeCompletedSession: (sessionId: string, expectedRevision?: number) => Promise<SessionEntryResult>;
  startEmptyOrResume: () => Promise<SessionEntryResult>;
  startPlannedOrResume: (
    materialize: PlannedSessionMaterializer,
  ) => Promise<SessionEntryResult>;
};

export type SessionEntryDependencies = {
  enterExercise: typeof enterSessionFromExercise;
  reopenCompletedSession: (sessionId: string, options?: { expectedRevision: number }) => Promise<{ sessionId: string }>;
  loadActiveSessionId: () => Promise<string | null>;
  createEmptySession: () => Promise<{ sessionId: string }>;
};

/**
 * Coordinates Start and Resume through one active-draft recheck. The
 * default instance is shared by Today, Train and completed detail, so rapid taps or a route
 * transition cannot create two drafts in one JavaScript runtime.
 */
export function createSessionEntryCoordinator(
  dependencies: SessionEntryDependencies,
): SessionEntryCoordinator {
  let inFlight: Promise<SessionEntryResult> | null = null;

  const exerciseRequests = new Map<string, Promise<ExerciseEntryResult>>();

  const track = <T extends SessionEntryResult>(pending: Promise<T>): Promise<T> => {
    inFlight = pending;
    const clear = () => {
      if (inFlight === pending) inFlight = null;
    };
    void pending.then(clear, clear);
    return pending;
  };

  const runExclusive = (
    createSession: () => Promise<{ sessionId: string }>,
  ): Promise<SessionEntryResult> => {
    if (inFlight) {
      return inFlight;
    }

    const pending = (async (): Promise<SessionEntryResult> => {
      const activeSessionId = await dependencies.loadActiveSessionId();
      if (activeSessionId) {
        return { kind: 'resumed', sessionId: activeSessionId };
      }

      const created = await createSession();
      return { kind: 'started', sessionId: created.sessionId };
    })();

    return track(pending);
  };

  return {
    startFromExercise: (input) => {
      const accountRevision = getAccountLocalPreferenceAccountRevision();
      const key = `${accountRevision}:${input.exerciseDefinitionId}:${input.mode}`;
      const existing = exerciseRequests.get(key);
      if (existing) return existing;
      const previous = inFlight;
      const pending = track((async () => {
        if (previous) await previous.catch(() => undefined);
        if (accountRevision !== getAccountLocalPreferenceAccountRevision()) throw new Error('The account changed. Try again.');
        const activeSessionId = await dependencies.loadActiveSessionId();
        if (accountRevision !== getAccountLocalPreferenceAccountRevision()) throw new Error('The account changed. Try again.');
        return dependencies.enterExercise(input, activeSessionId);
      })());
      exerciseRequests.set(key, pending);
      const clear = () => { exerciseRequests.delete(key); };
      void pending.then(clear, clear);
      return pending;
    },
    resumeCompletedSession: (sessionId, expectedRevision) => {
      const previous = inFlight;
      return track((async () => {
        // Resume must recheck its own target after a pending Start, never inherit that workout's success.
        if (previous) await previous.catch(() => undefined);
        if (expectedRevision === undefined) await dependencies.reopenCompletedSession(sessionId);
        else await dependencies.reopenCompletedSession(sessionId, { expectedRevision });
        return { kind: 'resumed', sessionId };
      })());
    },
    startEmptyOrResume: () => runExclusive(dependencies.createEmptySession),
    startPlannedOrResume: (materialize) => runExclusive(materialize),
  };
}

/** The id of the one active (non-deleted) session, if there is one. */
export const loadActiveSessionId = (preferredId?: string | null): Promise<string | null> => findActiveSessionId(preferredId);

export const DEFAULT_SESSION_ENTRY_COORDINATOR = createSessionEntryCoordinator({
  enterExercise: enterSessionFromExercise,
  reopenCompletedSession: reopenCompletedSessionDraft,
  loadActiveSessionId,
  async createEmptySession() {
    return persistSessionDraftSnapshot({
      gymId: null,
      startedAt: new Date(),
      status: 'active',
      exercises: [],
    }, { requireNoActiveSession: true });
  },
});
