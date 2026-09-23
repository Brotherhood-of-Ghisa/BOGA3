import { listSessionListBuckets, persistSessionDraftSnapshot } from '@/src/data';

export type SessionEntryResult = {
  kind: 'resumed' | 'started';
  sessionId: string;
};

export type PlannedSessionMaterializer = () => Promise<{ sessionId: string }>;

export type SessionEntryCoordinator = {
  startEmptyOrResume: () => Promise<SessionEntryResult>;
  startPlannedOrResume: (
    materialize: PlannedSessionMaterializer,
  ) => Promise<SessionEntryResult>;
};

export type SessionEntryDependencies = {
  loadActiveSessionId: () => Promise<string | null>;
  createEmptySession: () => Promise<{ sessionId: string }>;
};

/**
 * Serializes every new-session request through one active-draft recheck. The
 * default instance is shared by Today and Train, so rapid taps or a route
 * transition cannot create two drafts in one JavaScript runtime.
 */
export function createSessionEntryCoordinator(
  dependencies: SessionEntryDependencies,
): SessionEntryCoordinator {
  let inFlight: Promise<SessionEntryResult> | null = null;

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

    inFlight = pending;
    const clear = () => {
      if (inFlight === pending) {
        inFlight = null;
      }
    };
    void pending.then(clear, clear);
    return pending;
  };

  return {
    startEmptyOrResume: () => runExclusive(dependencies.createEmptySession),
    startPlannedOrResume: (materialize) => runExclusive(materialize),
  };
}

/** The id of the one active (non-deleted) session, if there is one. */
export const loadActiveSessionId = async (): Promise<string | null> => {
  const buckets = await listSessionListBuckets();
  return buckets.active?.id ?? null;
};

export const DEFAULT_SESSION_ENTRY_COORDINATOR = createSessionEntryCoordinator({
  loadActiveSessionId,
  async createEmptySession() {
    return persistSessionDraftSnapshot({
      gymId: null,
      startedAt: new Date(),
      status: 'active',
      exercises: [],
    });
  },
});
