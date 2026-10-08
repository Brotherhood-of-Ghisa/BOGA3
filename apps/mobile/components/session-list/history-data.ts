import { useCallback, useEffect, useRef, useState } from 'react';

import {
  completeSessionDraft,
  listSessionListBuckets,
  persistSessionDraftSnapshot,
  setSessionDeletedState,
} from '@/src/data';
import { logEvent } from '@/src/logging';
import {
  createDrizzleProgressSummaryStore,
  type PersonalRecordFact,
  type ProgressSummaryStore,
  type SessionPersonalRecord,
} from '@/src/progress-summary';

import type { SessionListDataClient, SessionListItem } from './types';

type RepositorySummary =
  | Awaited<ReturnType<typeof listSessionListBuckets>>['completed'][number]
  | Awaited<ReturnType<typeof listSessionListBuckets>>['active'];

export const mapRepositorySummaryToSessionListItem = (
  summary: RepositorySummary
): SessionListItem | null => {
  if (!summary) {
    return null;
  }

  return {
    id: summary.id,
    startedAt: summary.startedAt.toISOString(),
    status: summary.status,
    completedAt: summary.completedAt ? summary.completedAt.toISOString() : null,
    durationSec: summary.durationSec,
    durationDisplay: summary.compactDuration,
    gymName: summary.gymName,
    exerciseCount: summary.exerciseCount,
    setCount: summary.setCount,
    totalWeight: 0,
    deletedAt: summary.deletedAt ? summary.deletedAt.toISOString() : null,
    records: [],
  };
};

const withoutPlacement = ({ kind, exerciseName, value, reps }: PersonalRecordFact): SessionPersonalRecord =>
  ({ kind, exerciseName, value, reps });

/**
 * Each completed session's PRs, read once over the span of the listed
 * completions (the same read as Today's latest session). Facts exist only for
 * live sessions, so a deleted row has none.
 */
export const attachSessionRecords = async (
  sessions: SessionListItem[],
  store: Pick<ProgressSummaryStore, 'loadRecordFacts'> = createDrizzleProgressSummaryStore(),
): Promise<SessionListItem[]> => {
  const completedAtMs = sessions.flatMap((session) => (session.completedAt ? [Date.parse(session.completedAt)] : []));
  if (completedAtMs.length === 0) return sessions;
  const facts = await store.loadRecordFacts({
    start: new Date(completedAtMs.reduce((min, ms) => Math.min(min, ms))),
    end: new Date(completedAtMs.reduce((max, ms) => Math.max(max, ms)) + 1),
  });
  const bySession = new Map<string, SessionPersonalRecord[]>();
  for (const fact of facts) {
    const records = bySession.get(fact.sessionId) ?? [];
    records.push(withoutPlacement(fact));
    bySession.set(fact.sessionId, records);
  }
  return sessions.map((session) => ({ ...session, records: bySession.get(session.id) ?? [] }));
};

export const DEFAULT_SESSION_LIST_DATA_CLIENT: SessionListDataClient = {
  async loadSessions({ showDeletedSessions }) {
    const buckets = await listSessionListBuckets({
      includeDeleted: showDeletedSessions,
    });

    const active = mapRepositorySummaryToSessionListItem(buckets.active);
    const completed = buckets.completed
      .map((summary) => mapRepositorySummaryToSessionListItem(summary))
      .filter((summary): summary is SessionListItem => summary !== null);
    // PR lines are enrichment: a failed read leaves the history listed
    // without them (`ux-rules.md` "States and feedback" 4).
    const completedWithRecords = await attachSessionRecords(completed).catch((error: unknown) => {
      void logEvent({
        level: 'warn',
        source: 'database',
        event: 'sessions.records_read_failed',
        message: error instanceof Error ? error.message : String(error),
      });
      return completed;
    });

    return active ? [active, ...completedWithRecords] : completedWithRecords;
  },
  async startSession() {
    await persistSessionDraftSnapshot({
      gymId: null,
      startedAt: new Date(),
      status: 'active',
      exercises: [],
    });
  },
  async completeActiveSession(sessionId) {
    await completeSessionDraft(sessionId);
  },
  async discardActiveSession(sessionId) {
    await setSessionDeletedState(sessionId, true);
  },
};

export type UseSessionListDataInput = {
  dataClient?: SessionListDataClient;
  initialSessions: SessionListItem[];
  showDeletedSessions: boolean;
  isFocused: boolean;
};

export type UseSessionListDataResult = {
  sessions: SessionListItem[];
  setSessions: React.Dispatch<React.SetStateAction<SessionListItem[]>>;
  isLoadingSessions: boolean;
  loadErrorMessage: string | null;
  // Epoch-ms the sessions were last loaded: an active session's elapsed time
  // is measured to it.
  loadedAtMs: number;
  reloadSessions: () => Promise<void>;
};

export function useSessionListData({
  dataClient,
  initialSessions,
  showDeletedSessions,
  isFocused,
}: UseSessionListDataInput): UseSessionListDataResult {
  const [sessions, setSessions] = useState<SessionListItem[]>(
    dataClient ? [] : initialSessions
  );
  const [isLoadingSessions, setIsLoadingSessions] = useState(
    Boolean(dataClient && isFocused)
  );
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [loadedAtMs, setLoadedAtMs] = useState(() => Date.now());
  const requestGenerationRef = useRef(0);
  const isMountedRef = useRef(true);
  const showDeletedSessionsRef = useRef(showDeletedSessions);

  // Declared before the load effect below, so a toggle's reload reads the new value.
  useEffect(() => {
    showDeletedSessionsRef.current = showDeletedSessions;
  }, [showDeletedSessions]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  // Fetches and applies the sessions; the caller has already shown loading.
  const fetchSessions = useCallback((): Promise<void> => {
    if (!dataClient) {
      return Promise.resolve();
    }

    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    const isCurrent = () =>
      isMountedRef.current && requestGenerationRef.current === requestGeneration;

    return dataClient
      .loadSessions({ showDeletedSessions: showDeletedSessionsRef.current })
      .then(
        (loadedSessions) => {
          if (!isCurrent()) return;
          setLoadedAtMs(Date.now());
          setSessions(loadedSessions);
        },
        (error: unknown) => {
          if (!isCurrent()) return;
          setLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load sessions');
        }
      )
      .finally(() => {
        if (isCurrent()) {
          setIsLoadingSessions(false);
        }
      });
  }, [dataClient]);

  const reloadSessions = useCallback(async () => {
    if (!dataClient) {
      return;
    }
    if (isMountedRef.current) {
      setIsLoadingSessions(true);
      setLoadErrorMessage(null);
    }
    await fetchSessions();
  }, [dataClient, fetchSessions]);

  // Focusing, or changing what is listed, starts a load: show it in this render.
  const [loadInputs, setLoadInputs] = useState({ dataClient, isFocused, showDeletedSessions });
  if (
    loadInputs.dataClient !== dataClient ||
    loadInputs.isFocused !== isFocused ||
    loadInputs.showDeletedSessions !== showDeletedSessions
  ) {
    setLoadInputs({ dataClient, isFocused, showDeletedSessions });
    if (dataClient && isFocused) {
      setIsLoadingSessions(true);
      setLoadErrorMessage(null);
    }
  }

  useEffect(() => {
    if (!dataClient || !isFocused) {
      return;
    }

    void fetchSessions();

    return () => {
      requestGenerationRef.current += 1;
    };
  }, [dataClient, fetchSessions, isFocused, showDeletedSessions]);

  return {
    sessions,
    setSessions,
    isLoadingSessions,
    loadErrorMessage,
    loadedAtMs,
    reloadSessions,
  };
}
