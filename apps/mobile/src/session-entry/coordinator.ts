import { findActiveSessionId, persistSessionDraftSnapshot, reopenCompletedSessionDraft } from '@/src/data';

export type SessionEntryResult = {
  kind: 'resumed' | 'started';
  sessionId: string;
};

export type PlannedSessionMaterializer = () => Promise<{ sessionId: string }>;

export type SessionEntryCoordinator = {
  resumeCompletedSession: (sessionId: string) => Promise<SessionEntryResult>;
  startEmptyOrResume: () => Promise<SessionEntryResult>;
  startPlannedOrResume: (
    materialize: PlannedSessionMaterializer,
  ) => Promise<SessionEntryResult>;
};

export type SessionEntryDependencies = {
  reopenCompletedSession: (sessionId: string) => Promise<{ sessionId: string }>;
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

  const track = (pending: Promise<SessionEntryResult>) => {
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
    resumeCompletedSession: (sessionId) => {
      const previous = inFlight;
      return track((async () => {
        // Resume must recheck its own target after a pending Start, never inherit that workout's success.
        if (previous) await previous.catch(() => undefined);
        await dependencies.reopenCompletedSession(sessionId);
        return { kind: 'resumed', sessionId };
      })());
    },
    startEmptyOrResume: () => runExclusive(dependencies.createEmptySession),
    startPlannedOrResume: (materialize) => runExclusive(materialize),
  };
}

/** The id of the one active (non-deleted) session, if there is one. */
export const loadActiveSessionId = (): Promise<string | null> => findActiveSessionId();

export const DEFAULT_SESSION_ENTRY_COORDINATOR = createSessionEntryCoordinator({
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
